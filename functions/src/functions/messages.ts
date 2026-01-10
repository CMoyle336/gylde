/**
 * Message-related Cloud Functions
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../config/firebase";
import { ActivityService } from "../services";
import * as logger from "firebase-functions/logger";

/**
 * Triggered when a new message is created.
 * Creates an activity record for the recipient.
 */
export const onMessageCreated = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("No data associated with the message event");
      return;
    }

    const messageData = snapshot.data();
    const conversationId = event.params.conversationId;
    const senderId = messageData.senderId;

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

      // Get sender info from conversation's participantInfo
      const participantInfo = conversationData.participantInfo || {};
      const senderInfo = participantInfo[senderId] || {};
      const senderName = senderInfo.displayName || "Someone";
      const senderPhoto = senderInfo.photoURL || null;

      // Create or update activity for the recipient
      // Uses upsert to avoid duplicate message activities from same user
      await ActivityService.upsertActivity(
        recipientId,
        "message",
        senderId,
        senderName,
        senderPhoto
      );

      logger.info(`Message activity upserted for ${recipientId} from ${senderName}`);
    } catch (error) {
      logger.error("Error creating message activity:", error);
    }
  }
);
