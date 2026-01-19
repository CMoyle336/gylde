/**
 * Favorite-related Cloud Functions
 */
import {onDocumentCreated, onDocumentDeleted} from "firebase-functions/v2/firestore";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {ActivityService, UserService} from "../services";
import {UserDisplayInfo} from "../types";
import * as logger from "firebase-functions/logger";

/**
 * Check if a user has premium subscription
 */
async function isPremiumUser(userId: string): Promise<boolean> {
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();
  
  const tier = privateDoc.data()?.subscription?.tier;
  return tier === "premium";
}

/**
 * Check if two users are blocked (either direction)
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  // Check if userId1 blocked userId2
  const blocked1Doc = await db
    .collection("users")
    .doc(userId1)
    .collection("blocks")
    .doc(userId2)
    .get();
  
  if (blocked1Doc.exists) return true;

  // Check if userId2 blocked userId1
  const blocked2Doc = await db
    .collection("users")
    .doc(userId2)
    .collection("blocks")
    .doc(userId1)
    .get();

  return blocked2Doc.exists;
}

/**
 * Triggered when a user favorites another user.
 * Creates an activity record for the recipient (unless the favorite is private).
 */
export const onFavoriteCreated = onDocumentCreated(
  "users/{userId}/favorites/{favoritedUserId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("No data associated with the event");
      return;
    }

    const favoriteData = snapshot.data();
    const fromUserId = event.params.userId;
    const toUserId = event.params.favoritedUserId;
    const isPrivate = favoriteData?.private === true;

    logger.info(`User ${fromUserId} favorited user ${toUserId} (private: ${isPrivate})`);

    try {
      // Check if users are blocked - if so, skip all activity creation
      const blocked = await areUsersBlocked(fromUserId, toUserId);
      if (blocked) {
        logger.info(`Skipping favorite processing - users ${fromUserId} and ${toUserId} are blocked`);
        return;
      }

      // Increment the user's favorites count (for trust score calculation)
      await db.collection("users").doc(fromUserId).update({
        favoritesCount: FieldValue.increment(1),
      });

      // Get the user's display info
      const fromUser = await UserService.getDisplayInfo(fromUserId);

      // Only create activity if the favorite is not private AND recipient is premium
      // (only premium users can see who favorited them)
      if (!isPrivate) {
        const recipientIsPremium = await isPremiumUser(toUserId);
        if (recipientIsPremium) {
          // Create activity for the favorited user
          await ActivityService.createActivity(
            toUserId,
            "favorite",
            fromUserId,
            fromUser.displayName || "Someone",
            fromUser.photoURL || null,
            `/user/${fromUserId}` // Link to the user's profile who favorited them
          );
        } else {
          logger.info(`Skipping favorite activity for ${toUserId} - not a premium user`);
        }
      }

      // Check for mutual favorite (match)
      // Note: A match can still occur even if one favorite is private
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
      // Decrement the user's favorites count (for trust score calculation)
      await db.collection("users").doc(fromUserId).update({
        favoritesCount: FieldValue.increment(-1),
      });

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

  logger.info("Match and match activities removed for both users");
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

  // Double-check users aren't blocked (race condition safety)
  const blocked = await areUsersBlocked(fromUserId, toUserId);
  if (blocked) {
    logger.info(`Skipping match creation - users are blocked`);
    return;
  }

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
      toUser.photoURL || null,
      `/user/${toUserId}` // Link to the matched user's profile
    ),
    ActivityService.createActivity(
      toUserId,
      "match",
      fromUserId,
      fromUser.displayName || "Someone",
      fromUser.photoURL || null,
      `/user/${fromUserId}` // Link to the matched user's profile
    ),
  ]);

  logger.info("Match activities created for both users");
}
