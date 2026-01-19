/**
 * Message-related Cloud Functions
 *
 * Handles:
 * - Activity notifications for new messages
 * - Message metrics tracking for reputation
 * - Burst messaging detection (real-time reputation trigger)
 * - Response tracking for ghost detection
 */
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {ActivityService, sendMessageEmailNotification, initializeEmailService} from "../services";
import * as logger from "firebase-functions/logger";
import {
  REPUTATION_CONFIG,
  MessageMetrics,
  ReputationTier,
  ReputationData,
  canTierMessage,
  getTierConfig,
} from "../types";
import {recalculateReputation} from "./reputation";

/**
 * Check if two users are blocked (either direction)
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  const blocked1Doc = await db
    .collection("users")
    .doc(userId1)
    .collection("blocks")
    .doc(userId2)
    .get();

  if (blocked1Doc.exists) return true;

  const blocked2Doc = await db
    .collection("users")
    .doc(userId2)
    .collection("blocks")
    .doc(userId1)
    .get();

  return blocked2Doc.exists;
}

/**
 * Triggered when a new message is created.
 * - Creates an activity record for the recipient
 * - Updates message metrics for reputation calculation
 * - Detects burst messaging (triggers real-time reputation recalc)
 */
export const onMessageCreated = onDocumentCreated(
  {
    document: "conversations/{conversationId}/messages/{messageId}",
    secrets: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("No data associated with the message event");
      return;
    }

    const messageData = snapshot.data();
    const conversationId = event.params.conversationId;
    const senderId = messageData.senderId;
    const messageContent = messageData.content || "";
    const messageType = messageData.type || "text";

    logger.info(`New message in conversation ${conversationId} from ${senderId}`);

    try {
      // Get the conversation to find the recipient
      const conversationDoc = await db
        .collection("conversations")
        .doc(conversationId)
        .get();

      if (!conversationDoc.exists) {
        logger.warn(`Conversation ${conversationId} not found`);
        return;
      }

      const conversationData = conversationDoc.data();
      if (!conversationData) {
        logger.warn(`Conversation ${conversationId} has no data`);
        return;
      }

      const participants: string[] = conversationData.participants || [];
      const recipientId = participants.find((uid: string) => uid !== senderId);

      if (!recipientId) {
        logger.warn(`Could not find recipient in conversation ${conversationId}`);
        return;
      }

      // Check if users are blocked - skip activity if blocked
      const blocked = await areUsersBlocked(senderId, recipientId);
      if (blocked) {
        logger.info(`Skipping message activity - users ${senderId} and ${recipientId} are blocked`);
        return;
      }

      // Fetch sender's profile directly (not from conversation's stale participantInfo)
      const senderDoc = await db.collection("users").doc(senderId).get();
      const senderData = senderDoc.data() || {};
      const senderName = senderData.displayName || "Someone";
      const senderPhoto = senderData.photoURL || null;

      // === ACTIVITY NOTIFICATION ===
      // Create or update activity for the recipient
      await ActivityService.upsertActivity(
        recipientId,
        "message",
        senderId,
        senderName,
        senderPhoto,
        `/messages/${conversationId}`
      );

      // === EMAIL NOTIFICATION ===
      // Send email notification (with rate limiting, async)
      initializeEmailService();
      sendMessageEmailNotification(recipientId, senderId, senderName, conversationId)
        .catch((err) => logger.error("Error sending message email:", err));

      // === MESSAGE METRICS TRACKING ===
      const now = Date.now();
      const today = new Date().toISOString().split("T")[0];

      // Get sender's current metrics
      const senderPrivateDoc = await db
        .collection("users")
        .doc(senderId)
        .collection("private")
        .doc("data")
        .get();

      const senderPrivateData = senderPrivateDoc.data() || {};
      const senderMetrics = (senderPrivateData.messageMetrics || {}) as MessageMetrics;

      // Calculate message length for text messages
      const messageLength = messageType === "text" ? messageContent.length : 0;

      // Update recent timestamps for burst detection
      let recentTimestamps = senderMetrics.recentSendTimestamps || [];
      const windowStart = now - REPUTATION_CONFIG.burst.windowMs;

      // Filter to only keep timestamps within the burst window
      recentTimestamps = recentTimestamps.filter((ts: number) => ts > windowStart);
      recentTimestamps.push(now);

      // Keep only the last N timestamps
      if (recentTimestamps.length > REPUTATION_CONFIG.burst.maxMessages + 5) {
        recentTimestamps = recentTimestamps.slice(-REPUTATION_CONFIG.burst.maxMessages - 5);
      }

      // Check for burst messaging
      const isBurst = recentTimestamps.length > REPUTATION_CONFIG.burst.maxMessages;

      // Check if this is a new day (reset sentToday counter)
      const lastSentDate = senderMetrics.lastSentDate || "";
      const sentToday = lastSentDate === today ?
        (senderMetrics.sentToday || 0) + 1 :
        1;

      // Update sender's metrics
      const senderMetricsUpdate: Partial<MessageMetrics> = {
        messageCount: (senderMetrics.messageCount || 0) + 1,
        totalMessageLength: (senderMetrics.totalMessageLength || 0) + messageLength,
        sentToday,
        lastSentDate: today,
        recentSendTimestamps: recentTimestamps,
      };

      // Check if this is the first message in this conversation
      // (for tracking conversations started)
      const messagesInConvo = await db
        .collection("conversations")
        .doc(conversationId)
        .collection("messages")
        .where("senderId", "==", senderId)
        .limit(2) // Only need to know if there's more than 1
        .get();

      if (messagesInConvo.size === 1) {
        // This is the first message from this user in this conversation
        senderMetricsUpdate.conversationsStarted =
          (senderMetrics.conversationsStarted || 0) + 1;
      }

      // Write sender metrics update
      // Note: Use nested object structure for reputation fields
      // (dot notation in keys doesn't work with set+merge, creates literal field names)
      await db
        .collection("users")
        .doc(senderId)
        .collection("private")
        .doc("data")
        .set(
          {
            messageMetrics: senderMetricsUpdate,
            // Update reputation's daily counter using nested object (not dot notation)
            reputation: {
              messagesSentToday: sentToday,
              lastMessageDate: today,
            },
          },
          {merge: true}
        );

      // === RECIPIENT METRICS ===
      // Track that recipient received a message (for response rate calculation)
      await db
        .collection("users")
        .doc(recipientId)
        .collection("private")
        .doc("data")
        .set(
          {
            messageMetrics: {
              received: FieldValue.increment(1),
              pendingResponses: FieldValue.increment(1),
              lastReceivedAt: Timestamp.now(),
            },
          },
          {merge: true}
        );

      // === BURST DETECTION ===
      if (isBurst) {
        logger.warn(`Burst messaging detected for user ${senderId}`);

        // Set burst score and trigger reputation recalculation
        await db
          .collection("users")
          .doc(senderId)
          .collection("private")
          .doc("data")
          .set(
            {burstScore: 1.0}, // Max burst penalty
            {merge: true}
          );

        // Trigger real-time reputation recalculation
        await recalculateReputation(senderId);

        logger.info(`Reputation recalculated for ${senderId} due to burst messaging`);
      }

      // Update sender's last message timestamp (for trust score)
      await db.collection("users").doc(senderId).update({
        lastMessageSentAt: FieldValue.serverTimestamp(),
      });

      logger.info(`Message activity and metrics updated for ${conversationId}`);
    } catch (error) {
      logger.error("Error processing message:", error);
    }
  }
);

/**
 * Track when a user views a conversation (marks messages as read)
 * This helps calculate response rate and ghost detection
 *
 * Triggers when lastViewedAt is updated for a user
 */
export const onConversationViewed = onDocumentUpdated(
  "conversations/{conversationId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) {
      return;
    }

    const conversationId = event.params.conversationId;
    const participants: string[] = after.participants || [];

    // Check if lastViewedAt changed for any participant
    const beforeLastViewed = before.lastViewedAt || {};
    const afterLastViewed = after.lastViewedAt || {};

    for (const userId of participants) {
      const beforeTime = beforeLastViewed[userId];
      const afterTime = afterLastViewed[userId];

      // If this user just viewed the conversation
      if (afterTime && (!beforeTime || afterTime !== beforeTime)) {
        const otherUserId = participants.find((uid) => uid !== userId);

        if (otherUserId) {
          // Check if there were pending messages from the other user
          const userPrivateDoc = await db
            .collection("users")
            .doc(userId)
            .collection("private")
            .doc("data")
            .get();

          const userMetrics = userPrivateDoc.data()?.messageMetrics as MessageMetrics | undefined;

          if (userMetrics && userMetrics.pendingResponses > 0) {
            // User responded (viewed = implicit acknowledgment)
            // We'll update replied count when they actually send a message
            logger.info(`User ${userId} viewed conversation ${conversationId}`);
          }
        }
      }
    }
  }
);

/**
 * Track when a user sends a reply in a conversation
 * Called after onMessageCreated to update response metrics
 */
export async function trackReply(
  senderId: string,
  conversationId: string
): Promise<void> {
  try {
    // Get the conversation to find the other participant
    const conversationDoc = await db
      .collection("conversations")
      .doc(conversationId)
      .get();

    if (!conversationDoc.exists) {
      return;
    }

    const conversationData = conversationDoc.data();
    const participants: string[] = conversationData?.participants || [];
    const otherUserId = participants.find((uid) => uid !== senderId);

    if (!otherUserId) {
      return;
    }

    // Check if there were messages from the other user that sender is replying to
    const lastMessageFromOther = await db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .where("senderId", "==", otherUserId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (!lastMessageFromOther.empty) {
      // This is a reply - update sender's replied count
      await db
        .collection("users")
        .doc(senderId)
        .collection("private")
        .doc("data")
        .set(
          {
            messageMetrics: {
              replied: FieldValue.increment(1),
              pendingResponses: FieldValue.increment(-1),
            },
          },
          {merge: true}
        );

      // Also track that the other user got a reply (for their conversations with replies count)
      await db
        .collection("users")
        .doc(otherUserId)
        .collection("private")
        .doc("data")
        .set(
          {
            messageMetrics: {
              conversationsWithReplies: FieldValue.increment(1),
            },
          },
          {merge: true}
        );

      logger.info(`Reply tracked: ${senderId} replied to ${otherUserId}`);
    }
  } catch (error) {
    logger.error("Error tracking reply:", error);
  }
}

// ============================================================================
// MESSAGING PERMISSION CHECKS
// ============================================================================

/**
 * Check if a user can send a message to another user
 * Enforces:
 * - Daily message limit based on sender's tier (bypassed for premium users)
 * - Tier-based messaging permissions (bypassed for premium users)
 *
 * Returns:
 * - allowed: boolean - whether messaging is allowed
 * - reason: string - if not allowed, explains why
 * - dailyLimit: number - sender's daily message limit (-1 for unlimited)
 * - sentToday: number - messages sent today
 * - remaining: number - messages remaining today (-1 for unlimited)
 */
export const checkMessagePermission = onCall<{
  recipientId: string;
}>(
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const senderId = request.auth.uid;
    const {recipientId} = request.data;

    if (!recipientId) {
      throw new HttpsError("invalid-argument", "Recipient ID is required");
    }

    if (senderId === recipientId) {
      return {
        allowed: false,
        reason: "cannot_message_self",
        dailyLimit: 0,
        sentToday: 0,
        remaining: 0,
      };
    }

    try {
      // Fetch sender and recipient reputation data in parallel
      const [senderPrivateDoc, recipientPrivateDoc] = await Promise.all([
        db.collection("users").doc(senderId).collection("private").doc("data").get(),
        db.collection("users").doc(recipientId).collection("private").doc("data").get(),
      ]);

      const senderPrivateData = senderPrivateDoc.data();
      const senderReputation = senderPrivateData?.reputation as ReputationData | undefined;
      const recipientReputation = recipientPrivateDoc.data()?.reputation as ReputationData | undefined;

      const senderTier: ReputationTier = senderReputation?.tier ?? "new";
      const recipientTier: ReputationTier = recipientReputation?.tier ?? "new";

      // Check if sender is a premium subscriber - they bypass all restrictions
      const isPremium = senderPrivateData?.subscription?.tier === "premium";

      if (isPremium) {
        // Premium users have unlimited messaging to anyone
        // Still need to check blocked status though
        const [blockedDoc, blockedByDoc] = await Promise.all([
          db.collection("users").doc(senderId).collection("blocks").doc(recipientId).get(),
          db.collection("users").doc(senderId).collection("blockedBy").doc(recipientId).get(),
        ]);

        if (blockedDoc.exists || blockedByDoc.exists) {
          return {
            allowed: false,
            reason: "blocked",
            dailyLimit: -1, // Unlimited
            sentToday: 0,
            remaining: -1, // Unlimited
            isPremium: true,
          };
        }

        return {
          allowed: true,
          reason: null,
          dailyLimit: -1, // Unlimited
          sentToday: 0,
          remaining: -1, // Unlimited
          senderTier,
          recipientTier,
          isPremium: true,
        };
      }

      // Non-premium users: apply reputation-based restrictions
      const tierConfig = getTierConfig(senderTier);
      const dailyLimit = tierConfig.dailyMessages;
      const isUnlimited = dailyLimit === -1;

      // Get today's date for checking daily counter
      const today = new Date().toISOString().split("T")[0];
      const lastMessageDate = senderReputation?.lastMessageDate ?? "";
      const sentToday = lastMessageDate === today ?
        (senderReputation?.messagesSentToday ?? 0) :
        0;

      const remaining = isUnlimited ? -1 : Math.max(0, dailyLimit - sentToday);

      // Check 1: Daily message limit (skip if unlimited)
      if (!isUnlimited && sentToday >= dailyLimit) {
        return {
          allowed: false,
          reason: "daily_limit_reached",
          dailyLimit,
          sentToday,
          remaining: 0,
          senderTier,
        };
      }

      // Check 2: Tier-based permissions
      if (!canTierMessage(senderTier, recipientTier)) {
        return {
          allowed: false,
          reason: "tier_restriction",
          senderTier,
          recipientTier,
          dailyLimit,
          sentToday,
          remaining,
          requiredTier: getMinimumTierToMessage(recipientTier),
        };
      }

      // Check 3: Blocked status
      const [blockedDoc, blockedByDoc] = await Promise.all([
        db.collection("users").doc(senderId).collection("blocks").doc(recipientId).get(),
        db.collection("users").doc(senderId).collection("blockedBy").doc(recipientId).get(),
      ]);

      if (blockedDoc.exists || blockedByDoc.exists) {
        return {
          allowed: false,
          reason: "blocked",
          dailyLimit,
          sentToday,
          remaining,
        };
      }

      // All checks passed
      return {
        allowed: true,
        reason: null,
        dailyLimit,
        sentToday,
        remaining,
        senderTier,
        recipientTier,
      };
    } catch (error) {
      logger.error("Error checking message permission:", error);
      throw new HttpsError("internal", "Failed to check message permission");
    }
  }
);

/**
 * Get the minimum tier required to message a given tier
 */
function getMinimumTierToMessage(recipientTier: ReputationTier): ReputationTier {
  // Check each tier from lowest to highest
  const tiers: ReputationTier[] = ["new", "active", "established", "trusted", "distinguished"];

  for (const tier of tiers) {
    if (canTierMessage(tier, recipientTier)) {
      return tier;
    }
  }

  return "distinguished"; // Fallback (shouldn't happen)
}

/**
 * Get current user's messaging status
 * Returns daily limit, messages sent, and remaining
 * Premium users have unlimited messaging
 */
export const getMessagingStatus = onCall<void>(
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

      const privateData = privateDoc.data();
      const reputation = privateData?.reputation as ReputationData | undefined;
      const tier: ReputationTier = reputation?.tier ?? "new";

      // Check if user is premium - they have unlimited messaging
      const isPremium = privateData?.subscription?.tier === "premium";

      if (isPremium) {
        return {
          tier,
          dailyLimit: -1, // Unlimited
          sentToday: 0,
          remaining: -1, // Unlimited
          canMessageTiers: ["new", "active", "established", "trusted", "distinguished"],
          isPremium: true,
        };
      }

      // Non-premium users: apply reputation-based limits
      const tierConfig = getTierConfig(tier);
      const isUnlimited = tierConfig.dailyMessages === -1;

      const today = new Date().toISOString().split("T")[0];
      const lastMessageDate = reputation?.lastMessageDate ?? "";
      const sentToday = lastMessageDate === today ?
        (reputation?.messagesSentToday ?? 0) :
        0;

      return {
        tier,
        dailyLimit: tierConfig.dailyMessages,
        sentToday,
        remaining: isUnlimited ? -1 : Math.max(0, tierConfig.dailyMessages - sentToday),
        canMessageTiers: tierConfig.canMessage === "all" ?
          ["new", "active", "established", "trusted", "distinguished"] :
          tierConfig.canMessage,
        isPremium: false,
        isUnlimited,
      };
    } catch (error) {
      logger.error("Error getting messaging status:", error);
      throw new HttpsError("internal", "Failed to get messaging status");
    }
  }
);
