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
  REPUTATION_TIER_ORDER,
  MessageMetrics,
  ReputationTier,
  ReputationData,
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

      const isFirstMessageInConvo = messagesInConvo.size === 1;

      if (isFirstMessageInConvo) {
        // This is the first message from this user in this conversation
        senderMetricsUpdate.conversationsStarted =
          (senderMetrics.conversationsStarted || 0) + 1;
      }

      // Check if this is a new conversation with a higher-tier user
      // (for tracking daily higher-tier conversation limit)
      let isHigherTierNewConvo = false;
      if (isFirstMessageInConvo) {
        // Get both users' reputation tiers
        const [senderPrivate, recipientPrivate] = await Promise.all([
          db.collection("users").doc(senderId).collection("private").doc("data").get(),
          db.collection("users").doc(recipientId).collection("private").doc("data").get(),
        ]);

        const senderTier = senderPrivate.data()?.reputation?.tier ?? "new";
        const recipientTier = recipientPrivate.data()?.reputation?.tier ?? "new";

        const senderTierIndex = REPUTATION_TIER_ORDER.indexOf(senderTier);
        const recipientTierIndex = REPUTATION_TIER_ORDER.indexOf(recipientTier);
        isHigherTierNewConvo = recipientTierIndex > senderTierIndex;
      }

      // Build reputation update
      const reputationUpdate: Record<string, unknown> = {};
      if (isHigherTierNewConvo) {
        // Increment higher-tier conversation counter
        const senderReputation = senderPrivateData.reputation as ReputationData | undefined;
        const lastConvoDate = senderReputation?.lastConversationDate ?? "";
        const currentCount = lastConvoDate === today ?
          (senderReputation?.higherTierConversationsToday ?? 0) : 0;

        reputationUpdate.higherTierConversationsToday = currentCount + 1;
        reputationUpdate.lastConversationDate = today;
      }

      // Write sender metrics update
      // Note: Use nested object structure for reputation fields
      await db
        .collection("users")
        .doc(senderId)
        .collection("private")
        .doc("data")
        .set(
          {
            messageMetrics: senderMetricsUpdate,
            ...(Object.keys(reputationUpdate).length > 0 ? {reputation: reputationUpdate} : {}),
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
 *
 * New messaging rules:
 * - If a conversation already exists between users → unlimited messages
 * - If starting a NEW conversation:
 *   - Same tier or lower tier recipient → always allowed
 *   - Higher tier recipient → limited per day (based on sender's tier)
 * - Premium users bypass all restrictions
 * - Blocked users cannot message each other
 *
 * Returns:
 * - allowed: boolean - whether messaging is allowed
 * - reason: string - if not allowed, explains why
 * - isNewConversation: boolean - whether this would be a new conversation
 * - isHigherTier: boolean - whether recipient is higher tier
 * - higherTierLimit: number - daily limit for higher-tier conversations (-1 = unlimited)
 * - higherTierConversationsToday: number - higher-tier conversations started today
 * - higherTierRemaining: number - higher-tier conversations remaining (-1 = unlimited)
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
      };
    }

    try {
      // Fetch sender and recipient data
      const [senderPrivateDoc, recipientPrivateDoc, blockedDoc, blockedByDoc] =
        await Promise.all([
          db.collection("users").doc(senderId).collection("private").doc("data").get(),
          db.collection("users").doc(recipientId).collection("private").doc("data").get(),
          db.collection("users").doc(senderId).collection("blocks").doc(recipientId).get(),
          db.collection("users").doc(senderId).collection("blockedBy").doc(recipientId).get(),
        ]);

      // Check blocked status first
      if (blockedDoc.exists || blockedByDoc.exists) {
        return {
          allowed: false,
          reason: "blocked",
        };
      }

      // Check if conversation already exists by querying participants
      const existingConvSnapshot = await db.collection("conversations")
        .where("participants", "array-contains", senderId)
        .get();

      const existingConversation = existingConvSnapshot.docs.find((doc) => {
        const data = doc.data();
        return data.participants?.includes(recipientId);
      });

      const isNewConversation = !existingConversation;

      const senderPrivateData = senderPrivateDoc.data();
      const senderReputation = senderPrivateData?.reputation as ReputationData | undefined;
      const recipientReputation = recipientPrivateDoc.data()?.reputation as ReputationData | undefined;

      const senderTier: ReputationTier = senderReputation?.tier ?? "new";
      const recipientTier: ReputationTier = recipientReputation?.tier ?? "new";
      const isPremium = senderPrivateData?.subscription?.tier === "premium";

      // Check if recipient is higher tier
      const senderTierIndex = REPUTATION_TIER_ORDER.indexOf(senderTier);
      const recipientTierIndex = REPUTATION_TIER_ORDER.indexOf(recipientTier);
      const isHigherTier = recipientTierIndex > senderTierIndex;

      // Premium users or existing conversations: always allowed
      if (isPremium || !isNewConversation) {
        return {
          allowed: true,
          reason: null,
          senderTier,
          recipientTier,
          isPremium,
          isNewConversation,
          isHigherTier,
          higherTierLimit: -1,
          higherTierConversationsToday: 0,
          higherTierRemaining: -1,
        };
      }

      // New conversation with same/lower tier: always allowed
      if (!isHigherTier) {
        return {
          allowed: true,
          reason: null,
          senderTier,
          recipientTier,
          isPremium: false,
          isNewConversation: true,
          isHigherTier: false,
          higherTierLimit: -1, // Not applicable
          higherTierConversationsToday: 0,
          higherTierRemaining: -1,
        };
      }

      // New conversation with higher tier: check daily limit
      const tierConfig = getTierConfig(senderTier);
      const higherTierLimit = tierConfig.dailyHigherTierConversations;
      const isUnlimited = higherTierLimit === -1;

      // Get today's date for checking daily counter
      const today = new Date().toISOString().split("T")[0];
      const lastConversationDate = senderReputation?.lastConversationDate ?? "";
      const higherTierConversationsToday = lastConversationDate === today ?
        (senderReputation?.higherTierConversationsToday ?? 0) :
        0;

      const higherTierRemaining = isUnlimited ? -1 : Math.max(0, higherTierLimit - higherTierConversationsToday);

      // Check if limit reached
      if (!isUnlimited && higherTierConversationsToday >= higherTierLimit) {
        return {
          allowed: false,
          reason: "higher_tier_limit_reached",
          senderTier,
          recipientTier,
          isPremium: false,
          isNewConversation: true,
          isHigherTier: true,
          higherTierLimit,
          higherTierConversationsToday,
          higherTierRemaining: 0,
        };
      }

      // All checks passed
      return {
        allowed: true,
        reason: null,
        senderTier,
        recipientTier,
        isPremium: false,
        isNewConversation: true,
        isHigherTier: true,
        higherTierLimit,
        higherTierConversationsToday,
        higherTierRemaining,
      };
    } catch (error) {
      logger.error("Error checking message permission:", error);
      throw new HttpsError("internal", "Failed to check message permission");
    }
  }
);

/**
 * Get current user's messaging status
 * Returns daily higher-tier conversation limit and remaining
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
          dailyHigherTierConversationLimit: -1, // Unlimited
          higherTierConversationsToday: 0,
          higherTierRemaining: -1, // Unlimited
          isPremium: true,
          isUnlimited: true,
        };
      }

      // Non-premium users: apply reputation-based limits
      const tierConfig = getTierConfig(tier);
      const isUnlimited = tierConfig.dailyHigherTierConversations === -1;

      const today = new Date().toISOString().split("T")[0];
      const lastConvoDate = reputation?.lastConversationDate ?? "";
      const usedToday = lastConvoDate === today ?
        (reputation?.higherTierConversationsToday ?? 0) :
        0;

      return {
        tier,
        dailyHigherTierConversationLimit: tierConfig.dailyHigherTierConversations,
        higherTierConversationsToday: usedToday,
        higherTierRemaining: isUnlimited ? -1 :
          Math.max(0, tierConfig.dailyHigherTierConversations - usedToday),
        isPremium: false,
        isUnlimited,
      };
    } catch (error) {
      logger.error("Error getting messaging status:", error);
      throw new HttpsError("internal", "Failed to get messaging status");
    }
  }
);
