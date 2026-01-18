/**
 * Reputation Engine Cloud Functions
 *
 * Hybrid calculation model:
 * - REAL-TIME: Identity verification, blocks, reports, burst messaging
 * - DAILY BATCH: Response rate, ghost rate, conversation quality, decay
 *
 * Core functions:
 * - recalculateReputation: Shared helper for scoring logic
 * - calculateAllReputations: Daily scheduled job
 * - reportUser: Create a report (triggers real-time recalc)
 * - getReputationStatus: Get user's own tier
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import {
  ReputationTier,
  ReputationData,
  ReputationSignals,
  MessageMetrics,
  ReportReason,
  REPUTATION_CONFIG,
  scoreToTier,
  getTierConfig,
  getDefaultSignals,
  getDefaultMessageMetrics,
} from "../types";

// ============================================================================
// CORE CALCULATION LOGIC
// ============================================================================

/**
 * Calculate reputation score from signals
 * Score ranges from 0-1000 (internal, never exposed)
 */
export function calculateScore(signals: ReputationSignals): number {
  const weights = REPUTATION_CONFIG.weights;

  let score = 0;

  // === POSITIVE SIGNALS ===

  // Profile completion (0-100 → 0-1)
  score += (signals.profileCompletion / 100) * weights.profileCompletion * 1000;

  // Identity verified (binary)
  score += (signals.identityVerified ? 1 : 0) * weights.identityVerified * 1000;

  // Account age (0-365 days → 0-1, capped at 1 year)
  const ageRatio = Math.min(
    signals.accountAgeDays / REPUTATION_CONFIG.accountAge.maxDaysForBonus,
    1
  );
  score += ageRatio * weights.accountAge * 1000;

  // Response rate (0-1)
  score += signals.responseRate * weights.responseRate * 1000;

  // Conversation quality (0-1)
  score += signals.conversationQuality * weights.conversationQuality * 1000;

  // === NEGATIVE SIGNALS (inverted: 0 = best, 1 = worst) ===

  // Block ratio (lower is better)
  score += (1 - signals.blockRatio) * weights.blockRatio * 1000;

  // Report ratio (lower is better)
  score += (1 - signals.reportRatio) * weights.reportRatio * 1000;

  // Ghost rate (lower is better)
  score += (1 - signals.ghostRate) * weights.ghostRate * 1000;

  // Burst score (lower is better)
  score += (1 - signals.burstScore) * weights.burstScore * 1000;

  return Math.round(Math.max(0, Math.min(1000, score)));
}

/**
 * Gather all signals for a user
 * This fetches data from various sources and calculates derived metrics
 */
async function gatherSignals(userId: string): Promise<ReputationSignals> {
  const signals = getDefaultSignals();

  // Fetch user document and private data in parallel
  const [userDoc, privateDoc] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("users").doc(userId).collection("private").doc("data").get(),
  ]);

  if (!userDoc.exists) {
    logger.warn(`User ${userId} not found for reputation calculation`);
    return signals;
  }

  const userData = userDoc.data();
  const privateData = privateDoc.exists ? privateDoc.data() : {};

  // === Profile completion (from existing trust system) ===
  const trustData = privateData?.trust;
  if (trustData?.score !== undefined) {
    signals.profileCompletion = trustData.score;
  }

  // === Identity verified ===
  signals.identityVerified = userData?.identityVerified === true;

  // === Account age ===
  const createdAt = userData?.createdAt as Timestamp | undefined;
  if (createdAt) {
    const createdDate = createdAt.toDate();
    const now = new Date();
    signals.accountAgeDays = Math.floor(
      (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // === Message metrics ===
  const messageMetrics = privateData?.messageMetrics as MessageMetrics | undefined;
  if (messageMetrics) {
    // Response rate
    if (messageMetrics.received > 0) {
      signals.responseRate = Math.min(
        messageMetrics.replied / messageMetrics.received,
        1
      );
    }

    // Conversation quality (based on avg message length)
    // Target: 100+ characters = quality 1.0
    if (messageMetrics.messageCount > 0) {
      const avgLength = messageMetrics.totalMessageLength / messageMetrics.messageCount;
      signals.conversationQuality = Math.min(avgLength / 100, 1);
    }

    // Ghost rate
    if (messageMetrics.conversationsStarted > 0) {
      const abandoned = messageMetrics.conversationsStarted -
        messageMetrics.conversationsWithReplies;
      signals.ghostRate = Math.min(
        abandoned / messageMetrics.conversationsStarted,
        1
      );
    }
  }

  // === Block ratio ===
  const blocksReceived = privateData?.blocksReceived ?? 0;
  const totalInteractions = (messageMetrics?.received ?? 0) +
    (messageMetrics?.conversationsStarted ?? 0);
  if (totalInteractions > 0) {
    signals.blockRatio = Math.min(blocksReceived / totalInteractions, 1);
  }

  // === Report ratio ===
  const reportsReceived = privateData?.reportsReceived ?? 0;
  if (totalInteractions > 0) {
    signals.reportRatio = Math.min(reportsReceived / totalInteractions, 1);
  }

  // === Burst score ===
  signals.burstScore = privateData?.burstScore ?? 0;

  return signals;
}

/**
 * Recalculate reputation for a single user
 * Called by both real-time triggers and daily batch job
 *
 * @param userId - The user to recalculate
 * @param forceSignals - Optional signals to use instead of gathering (for testing)
 * @returns The updated reputation data
 */
export async function recalculateReputation(
  userId: string,
  forceSignals?: Partial<ReputationSignals>
): Promise<ReputationData> {
  logger.info(`Recalculating reputation for user ${userId}`);

  // Gather current signals
  const signals = await gatherSignals(userId);

  // Apply any forced signals (for real-time updates)
  if (forceSignals) {
    Object.assign(signals, forceSignals);
  }

  // Calculate score
  const score = calculateScore(signals);
  const tier = scoreToTier(score);
  const tierConfig = getTierConfig(tier);

  // Get existing reputation data to preserve some fields
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();

  const existingReputation = privateDoc.data()?.reputation as ReputationData | undefined;
  const now = Timestamp.now();
  const today = new Date().toISOString().split("T")[0];

  // Check if tier changed
  const tierChanged = existingReputation?.tier !== tier;

  // Build reputation data
  const reputationData: ReputationData = {
    tier,
    score,
    lastCalculatedAt: now,
    tierChangedAt: tierChanged ? now : (existingReputation?.tierChangedAt ?? now),
    createdAt: existingReputation?.createdAt ?? now,
    dailyMessageLimit: tierConfig.dailyMessages,
    canMessageMinTier: tierConfig.canMessage === "all" ? "new" : tierConfig.canMessage[0],
    signals,
    messagesSentToday: existingReputation?.lastMessageDate === today
      ? (existingReputation?.messagesSentToday ?? 0)
      : 0,
    lastMessageDate: existingReputation?.lastMessageDate ?? today,
  };

  // Write to Firestore
  await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .set(
      {reputation: reputationData},
      {merge: true}
    );

  // Also denormalize tier to main user document for efficient queries
  await db.collection("users").doc(userId).update({
    reputationTier: tier,
  });

  if (tierChanged) {
    logger.info(
      `User ${userId} tier changed: ${existingReputation?.tier ?? "none"} → ${tier}`
    );
  }

  return reputationData;
}

// ============================================================================
// SCHEDULED FUNCTIONS
// ============================================================================

/**
 * Daily scheduled job to recalculate all user reputations
 * Runs at 3 AM UTC
 *
 * This handles:
 * - Recalculating all signals that need aggregation (response rate, etc.)
 * - Applying decay for inactive/misbehaving users
 * - Resetting daily counters
 */
export const calculateAllReputations = onSchedule(
  {
    schedule: "0 3 * * *", // 3 AM UTC daily
    timeZone: "UTC",
    region: "us-central1",
    timeoutSeconds: 540, // 9 minutes max
    memory: "512MiB",
  },
  async () => {
    logger.info("Starting daily reputation calculation");
    const startTime = Date.now();

    try {
      // Get all users with completed onboarding
      const usersSnapshot = await db
        .collection("users")
        .where("onboardingCompleted", "==", true)
        .select() // Only fetch document IDs, not full data
        .get();

      logger.info(`Processing ${usersSnapshot.size} users`);

      let processed = 0;
      let errors = 0;
      const today = new Date().toISOString().split("T")[0];

      // Process in batches to avoid memory issues
      const batchSize = 50;
      const userIds = usersSnapshot.docs.map((doc) => doc.id);

      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (userId) => {
            try {
              // Recalculate reputation
              await recalculateReputation(userId);

              // Reset daily message counter
              await db
                .collection("users")
                .doc(userId)
                .collection("private")
                .doc("data")
                .update({
                  "reputation.messagesSentToday": 0,
                  "reputation.lastMessageDate": today,
                  // Clear burst score if it was temporary
                  "burstScore": FieldValue.delete(),
                });

              processed++;
            } catch (error) {
              logger.error(`Error processing user ${userId}:`, error);
              errors++;
            }
          })
        );

        // Log progress
        logger.info(`Processed ${Math.min(i + batchSize, userIds.length)}/${userIds.length}`);
      }

      const duration = (Date.now() - startTime) / 1000;
      logger.info(
        `Daily reputation calculation complete. ` +
        `Processed: ${processed}, Errors: ${errors}, Duration: ${duration}s`
      );
    } catch (error) {
      logger.error("Fatal error in daily reputation calculation:", error);
      throw error;
    }
  }
);

// ============================================================================
// CALLABLE FUNCTIONS
// ============================================================================

/**
 * Report a user
 * Creates a report record and triggers immediate reputation recalculation
 */
export const reportUser = onCall<{
  userId: string;
  reason: ReportReason;
  details?: string;
  conversationId?: string;
}>(
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to report users");
    }

    const reporterId = request.auth.uid;
    const {userId, reason, details, conversationId} = request.data;

    // Validate input
    if (!userId) {
      throw new HttpsError("invalid-argument", "User ID is required");
    }
    if (userId === reporterId) {
      throw new HttpsError("invalid-argument", "Cannot report yourself");
    }
    if (!reason) {
      throw new HttpsError("invalid-argument", "Report reason is required");
    }

    logger.info(`User ${reporterId} reporting user ${userId} for ${reason}`);

    try {
      // Get reporter's private data (reputation tier and reporting history)
      const reporterPrivateDoc = await db
        .collection("users")
        .doc(reporterId)
        .collection("private")
        .doc("data")
        .get();

      const reporterData = reporterPrivateDoc.data() || {};
      const reporterTier = (reporterData?.reputation?.tier ?? "new") as ReputationTier;
      const reportingStats = reporterData?.reportingStats || {
        totalSubmitted: 0,
        dismissedCount: 0,
        lastReportAt: null,
      };

      // === RATE LIMITING BASED ON REPUTATION TIER ===
      // Higher reputation = more trusted = higher limits
      const rateLimits: Record<ReputationTier, { daily: number; weekly: number }> = {
        new: {daily: 2, weekly: 5},
        active: {daily: 3, weekly: 10},
        established: {daily: 5, weekly: 15},
        trusted: {daily: 7, weekly: 20},
        distinguished: {daily: 10, weekly: 30},
      };
      const limits = rateLimits[reporterTier];

      // === CHECK FOR ABUSE: High dismissal rate ===
      // If > 50% of reports are dismissed and they've submitted at least 5, restrict
      if (reportingStats.totalSubmitted >= 5) {
        const dismissalRate = reportingStats.dismissedCount / reportingStats.totalSubmitted;
        if (dismissalRate > 0.5) {
          logger.warn(`User ${reporterId} has high report dismissal rate: ${dismissalRate}`);
          throw new HttpsError(
            "permission-denied",
            "Your reporting privileges have been restricted due to a pattern of unsubstantiated reports. Please contact support if you believe this is an error."
          );
        }
      }

      // === CHECK: Duplicate report on same user within 24 hours ===
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const duplicateReports = await db
        .collection("reports")
        .where("reporterId", "==", reporterId)
        .where("reportedUserId", "==", userId)
        .where("createdAt", ">", oneDayAgo)
        .limit(1)
        .get();

      if (!duplicateReports.empty) {
        throw new HttpsError(
          "already-exists",
          "You have already reported this user recently. Our team is reviewing your previous report."
        );
      }

      // === CHECK: Daily report limit ===
      const dailyReports = await db
        .collection("reports")
        .where("reporterId", "==", reporterId)
        .where("createdAt", ">", oneDayAgo)
        .count()
        .get();

      if (dailyReports.data().count >= limits.daily) {
        throw new HttpsError(
          "resource-exhausted",
          `You have reached your daily report limit (${limits.daily}). Please try again tomorrow.`
        );
      }

      // === CHECK: Weekly report limit ===
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklyReports = await db
        .collection("reports")
        .where("reporterId", "==", reporterId)
        .where("createdAt", ">", oneWeekAgo)
        .count()
        .get();

      if (weeklyReports.data().count >= limits.weekly) {
        throw new HttpsError(
          "resource-exhausted",
          `You have reached your weekly report limit (${limits.weekly}). Please try again later.`
        );
      }

      // Create report record in top-level /reports collection
      const report = {
        reporterId,
        reportedUserId: userId,
        reporterTier: reporterTier,
        reason,
        details: details?.trim() || null,
        conversationId: conversationId || null,
        status: "pending" as const,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        reviewedBy: null,
        reviewNotes: null,
        actionTaken: null,
      };

      await db.collection("reports").add(report);

      // Update both reporter's and reported user's stats
      const batch = db.batch();

      // Increment reports received counter on reported user
      batch.set(
        db.collection("users").doc(userId).collection("private").doc("data"),
        {
          reportsReceived: FieldValue.increment(1),
          lastReportedAt: FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      // Update reporter's reporting stats
      batch.set(
        db.collection("users").doc(reporterId).collection("private").doc("data"),
        {
          reportingStats: {
            totalSubmitted: FieldValue.increment(1),
            lastReportAt: FieldValue.serverTimestamp(),
          },
        },
        {merge: true}
      );

      await batch.commit();

      // Trigger real-time reputation recalculation for reported user
      await recalculateReputation(userId);

      logger.info(`Report created for user ${userId}, reputation recalculated`);

      return {success: true};
    } catch (error) {
      logger.error("Error creating report:", error);
      throw new HttpsError("internal", "Failed to create report");
    }
  }
);

/**
 * Get current user's reputation status
 * Returns tier and limits, but NOT the internal score
 */
export const getReputationStatus = onCall<void>(
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const userId = request.auth.uid;

    try {
      const privateDoc = await db
        .collection("users")
        .doc(userId)
        .collection("private")
        .doc("data")
        .get();

      const reputation = privateDoc.data()?.reputation as ReputationData | undefined;

      if (!reputation) {
        // User hasn't been calculated yet - do it now
        const newReputation = await recalculateReputation(userId);
        return {
          tier: newReputation.tier,
          dailyMessageLimit: newReputation.dailyMessageLimit,
          messagesSentToday: newReputation.messagesSentToday,
          messagesRemaining: newReputation.dailyMessageLimit - newReputation.messagesSentToday,
          canMessageMinTier: newReputation.canMessageMinTier,
        };
      }

      return {
        tier: reputation.tier,
        dailyMessageLimit: reputation.dailyMessageLimit,
        messagesSentToday: reputation.messagesSentToday,
        messagesRemaining: reputation.dailyMessageLimit - reputation.messagesSentToday,
        canMessageMinTier: reputation.canMessageMinTier,
      };
    } catch (error) {
      logger.error("Error getting reputation status:", error);
      throw new HttpsError("internal", "Failed to get reputation status");
    }
  }
);

/**
 * Initialize reputation for a new user
 * Called after onboarding completion
 */
export async function initializeReputation(userId: string): Promise<void> {
  logger.info(`Initializing reputation for new user ${userId}`);

  const now = Timestamp.now();
  const today = new Date().toISOString().split("T")[0];

  // Initialize with default values
  const initialReputation: ReputationData = {
    tier: "new",
    score: 0,
    lastCalculatedAt: now,
    tierChangedAt: now,
    createdAt: now,
    dailyMessageLimit: REPUTATION_CONFIG.tiers.new.dailyMessages,
    canMessageMinTier: "active",
    signals: getDefaultSignals(),
    messagesSentToday: 0,
    lastMessageDate: today,
  };

  const initialMessageMetrics = getDefaultMessageMetrics();

  await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .set(
      {
        reputation: initialReputation,
        messageMetrics: initialMessageMetrics,
        blocksReceived: 0,
        reportsReceived: 0,
      },
      {merge: true}
    );

  // Denormalize tier to main document
  await db.collection("users").doc(userId).update({
    reputationTier: "new",
  });

  logger.info(`Reputation initialized for user ${userId}`);
}

// ============================================================================
// DEVELOPMENT/DEBUG FUNCTIONS
// ============================================================================

/**
 * Manually trigger reputation recalculation for the current user
 * This is intended for development/testing purposes
 */
export const refreshMyReputation = onCall<void>(
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const userId = request.auth.uid;

    try {
      logger.info(`Manual reputation refresh requested for user ${userId}`);

      const newReputation = await recalculateReputation(userId);

      return {
        success: true,
        tier: newReputation.tier,
        dailyMessageLimit: newReputation.dailyMessageLimit,
        messagesSentToday: newReputation.messagesSentToday,
      };
    } catch (error) {
      logger.error(`Error refreshing reputation for ${userId}:`, error);
      throw new HttpsError("internal", "Failed to refresh reputation");
    }
  }
);
