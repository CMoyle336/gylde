/**
 * Favorite-related Cloud Functions
 */
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { ActivityService, UserService } from "../services";
import { UserDisplayInfo } from "../types";
import * as logger from "firebase-functions/logger";

/**
 * Triggered when a user favorites another user.
 * Creates an activity record for the recipient.
 */
export const onFavoriteCreated = onDocumentCreated(
  "users/{userId}/favorites/{favoritedUserId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("No data associated with the event");
      return;
    }

    const fromUserId = event.params.userId;
    const toUserId = event.params.favoritedUserId;

    logger.info(`User ${fromUserId} favorited user ${toUserId}`);

    try {
      // Get the user's display info
      const fromUser = await UserService.getDisplayInfo(fromUserId);

      // Create activity for the favorited user
      await ActivityService.createActivity(
        toUserId,
        "favorite",
        fromUserId,
        fromUser.displayName || "Someone",
        fromUser.photoURL || null
      );

      // Check for mutual favorite (match)
      const mutualFavoriteDoc = await db
        .collection("users")
        .doc(toUserId)
        .collection("favorites")
        .doc(fromUserId)
        .get();

      if (mutualFavoriteDoc.exists) {
        await handleMatch(fromUserId, toUserId, fromUser);
      }
    } catch (error) {
      logger.error("Error creating favorite activity:", error);
    }
  }
);

/**
 * Triggered when a user unfavorites another user.
 * Deletes the corresponding activity record and handles unmatching.
 */
export const onFavoriteDeleted = onDocumentDeleted(
  "users/{userId}/favorites/{favoritedUserId}",
  async (event) => {
    const fromUserId = event.params.userId;
    const toUserId = event.params.favoritedUserId;

    logger.info(`User ${fromUserId} unfavorited user ${toUserId}`);

    try {
      // Delete the favorite activity
      await ActivityService.deleteActivities(toUserId, "favorite", fromUserId);

      // Check if there was a match and handle unmatching
      await handleUnmatch(fromUserId, toUserId);
    } catch (error) {
      logger.error("Error deleting favorite activity:", error);
    }
  }
);

/**
 * Handle unmatch when a user removes a favorite
 * Deletes match record and match activities for both users
 */
async function handleUnmatch(
  fromUserId: string,
  toUserId: string
): Promise<void> {
  // Check if a match exists between these users
  const matchId = [fromUserId, toUserId].sort().join("_");
  const matchRef = db.collection("matches").doc(matchId);
  const matchDoc = await matchRef.get();

  if (!matchDoc.exists) {
    logger.info(`No match to remove between ${fromUserId} and ${toUserId}`);
    return;
  }

  logger.info(`Removing match ${matchId}`);

  // Delete the match record
  await matchRef.delete();

  // Delete match activities for both users
  await Promise.all([
    ActivityService.deleteActivities(fromUserId, "match", toUserId),
    ActivityService.deleteActivities(toUserId, "match", fromUserId),
  ]);

  logger.info(`Match and match activities removed for both users`);
}

/**
 * Handle match creation when mutual favorites are detected
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
