/**
 * Like-related Cloud Functions
 */
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { ActivityService, UserService } from "../services";
import { UserDisplayInfo } from "../types";
import * as logger from "firebase-functions/logger";

/**
 * Triggered when a user likes another user.
 * Creates an activity record for the recipient.
 */
export const onLikeCreated = onDocumentCreated(
  "users/{userId}/likes/{likedUserId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("No data associated with the event");
      return;
    }

    const fromUserId = event.params.userId;
    const toUserId = event.params.likedUserId;

    logger.info(`User ${fromUserId} liked user ${toUserId}`);

    try {
      // Get the liker's display info
      const fromUser = await UserService.getDisplayInfo(fromUserId);

      // Create activity for the liked user
      await ActivityService.createActivity(
        toUserId,
        "like",
        fromUserId,
        fromUser.displayName || "Someone",
        fromUser.photoURL || null
      );

      // Check for mutual like (match)
      const mutualLikeDoc = await db
        .collection("users")
        .doc(toUserId)
        .collection("likes")
        .doc(fromUserId)
        .get();

      if (mutualLikeDoc.exists) {
        await handleMatch(fromUserId, toUserId, fromUser);
      }
    } catch (error) {
      logger.error("Error creating like activity:", error);
    }
  }
);

/**
 * Triggered when a user unlikes another user.
 * Deletes the corresponding activity record.
 */
export const onLikeDeleted = onDocumentDeleted(
  "users/{userId}/likes/{likedUserId}",
  async (event) => {
    const fromUserId = event.params.userId;
    const toUserId = event.params.likedUserId;

    logger.info(`User ${fromUserId} unliked user ${toUserId}`);

    try {
      await ActivityService.deleteActivities(toUserId, "like", fromUserId);
    } catch (error) {
      logger.error("Error deleting like activity:", error);
    }
  }
);

/**
 * Handle match creation when mutual likes are detected
 */
async function handleMatch(
  fromUserId: string,
  toUserId: string,
  fromUser: UserDisplayInfo
): Promise<void> {
  logger.info(`Match detected between ${fromUserId} and ${toUserId}`);

  // Create match record (sorted IDs to prevent duplicates)
  const matchId = [fromUserId, toUserId].sort().join("_");
  const matchRef = db.collection("matches").doc(matchId);
  const matchDoc = await matchRef.get();

  // Only create match if it doesn't already exist
  if (matchDoc.exists) {
    logger.info(`Match ${matchId} already exists`);
    return;
  }

  await matchRef.set({
    users: [fromUserId, toUserId],
    createdAt: FieldValue.serverTimestamp(),
  });

  // Get the other user's display info
  const toUser = await UserService.getDisplayInfo(toUserId);

  // Create match activities for both users
  await Promise.all([
    ActivityService.createActivity(
      fromUserId,
      "match",
      toUserId,
      toUser.displayName || "Someone",
      toUser.photoURL || null
    ),
    ActivityService.createActivity(
      toUserId,
      "match",
      fromUserId,
      fromUser.displayName || "Someone",
      fromUser.photoURL || null
    ),
  ]);

  logger.info(`Match activities created for both users`);
}
