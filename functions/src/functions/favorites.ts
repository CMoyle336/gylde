/**
 * Favorite-related Cloud Functions
 */
import {onDocumentCreated, onDocumentDeleted} from "firebase-functions/v2/firestore";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {ActivityService, UserService, sendEmailNotification, initializeEmailService} from "../services";
import {UserDisplayInfo} from "../types";
import * as logger from "firebase-functions/logger";

// ============================================================================
// Feed Backfill Types & Constants
// ============================================================================

const BACKFILL_LIMIT = 10; // Number of posts to backfill on new connection

interface FeedItemPreview {
  authorName: string;
  authorPhotoURL?: string;
  contentExcerpt: string;
  hasMedia: boolean;
}

interface FeedItem {
  postId: string;
  authorId: string;
  createdAt: FieldValue | Timestamp;
  insertedAt: FieldValue | Timestamp;
  reason: "connection" | "approved" | "systemBoost";
  visibility: "public" | "connections" | "private";
  regionId: string;
  preview: FeedItemPreview;
}

interface PostData {
  id: string;
  authorId: string;
  createdAt: Timestamp;
  visibility: "public" | "connections" | "private";
  regionId: string;
  content: {
    type: string;
    text?: string;
    media?: Array<{url: string}>;
  };
}

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
  {
    document: "users/{userId}/favorites/{favoritedUserId}",
    secrets: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
  },
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

          // Send email notification for favorite (async, don't block)
          initializeEmailService();
          sendEmailNotification(toUserId, "favorite", fromUser.displayName || "Someone", fromUserId)
            .catch((err) => logger.error("Error sending favorite email:", err));
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
 * Backfill connection posts to a user's feedItems
 */
async function backfillConnectionPosts(
  viewerId: string,
  authorId: string,
  authorName: string,
  authorPhotoURL: string | null
): Promise<void> {
  // Get recent connection posts from author
  const postsSnapshot = await db
    .collection("posts")
    .where("authorId", "==", authorId)
    .where("visibility", "==", "connections")
    .where("status", "==", "active")
    .orderBy("createdAt", "desc")
    .limit(BACKFILL_LIMIT)
    .get();

  if (postsSnapshot.empty) {
    return;
  }

  const bulkWriter = db.bulkWriter();

  for (const doc of postsSnapshot.docs) {
    const post = doc.data() as PostData;
    const contentExcerpt = post.content.text?.substring(0, 100) || "";
    const hasMedia = (post.content.media?.length || 0) > 0;

    const feedItem: FeedItem = {
      postId: post.id,
      authorId: post.authorId,
      createdAt: post.createdAt,
      insertedAt: FieldValue.serverTimestamp(),
      reason: "connection",
      visibility: post.visibility,
      regionId: post.regionId,
      preview: {
        authorName,
        ...(authorPhotoURL && {authorPhotoURL}),
        contentExcerpt,
        hasMedia,
      },
    };

    const feedItemRef = db
      .collection("users")
      .doc(viewerId)
      .collection("feedItems")
      .doc(post.id);

    bulkWriter.set(feedItemRef, feedItem);
  }

  await bulkWriter.close();
  logger.info(`Backfilled ${postsSnapshot.size} connection posts for ${viewerId} from ${authorId}`);
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
    logger.info("Skipping match creation - users are blocked");
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

  // Send email notifications for match (async, don't block)
  // Each user gets a link to the other user's profile
  initializeEmailService();
  sendEmailNotification(fromUserId, "match", toUser.displayName || "Someone", toUserId)
    .catch((err) => logger.error("Error sending match email to fromUser:", err));
  sendEmailNotification(toUserId, "match", fromUser.displayName || "Someone", fromUserId)
    .catch((err) => logger.error("Error sending match email to toUser:", err));

  // Backfill connection posts to each user's feed (async, don't block)
  // This ensures each user sees recent connection posts from their new match
  Promise.all([
    backfillConnectionPosts(fromUserId, toUserId, toUser.displayName || "Someone", toUser.photoURL || null),
    backfillConnectionPosts(toUserId, fromUserId, fromUser.displayName || "Someone", fromUser.photoURL || null),
  ]).catch((err) => logger.error("Error backfilling connection posts:", err));
}
