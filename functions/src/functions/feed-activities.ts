/**
 * Feed Activity Cloud Functions
 * Handles activity creation for social interactions (likes, comments on posts)
 * Separate from profile activities (favorites, matches, views, messages)
 */
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import * as logger from "firebase-functions/logger";
import { FeedActivity } from "../types";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get post author ID from post document
 */
async function getPostAuthorId(postId: string): Promise<string | null> {
  const postDoc = await db.collection("posts").doc(postId).get();
  if (!postDoc.exists) {
    return null;
  }
  return postDoc.data()?.authorId || null;
}

/**
 * Get comment author ID from comment document
 */
async function getCommentAuthorId(postId: string, commentId: string): Promise<string | null> {
  const commentDoc = await db.collection("posts").doc(postId).collection("comments").doc(commentId).get();
  if (!commentDoc.exists) {
    return null;
  }
  return commentDoc.data()?.authorId || null;
}

/**
 * Get user display info
 */
async function getUserDisplayInfo(userId: string): Promise<{ name: string; photo: string | null }> {
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();
  return {
    name: userData?.displayName || "Unknown User",
    photo: userData?.photoURL || null,
  };
}

/**
 * Check if two users have blocked each other (in either direction)
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  // Check if userId1 blocked userId2
  const blockedDoc = await db
    .collection("users")
    .doc(userId1)
    .collection("blocks")
    .doc(userId2)
    .get();

  if (blockedDoc.exists) return true;

  // Check if userId2 blocked userId1
  const blockedByDoc = await db
    .collection("users")
    .doc(userId1)
    .collection("blockedBy")
    .doc(userId2)
    .get();

  return blockedByDoc.exists;
}

/**
 * Build the feed activity document ID
 */
function buildFeedActivityId(fromUserId: string, postId: string): string {
  return `${fromUserId}_${postId}`;
}

/**
 * Upsert a feed activity for a like action
 */
async function upsertLikeFeedActivity(
  postAuthorId: string,
  postId: string,
  likerId: string,
  likerName: string,
  likerPhoto: string | null
): Promise<void> {
  const activityId = buildFeedActivityId(likerId, postId);
  const activityRef = db
    .collection("users")
    .doc(postAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const existingDoc = await activityRef.get();
  const now = Timestamp.now();

  if (existingDoc.exists) {
    // Update existing activity
    await activityRef.update({
      liked: true,
      lastInteractionAt: now,
      read: false, // Mark as unread on new interaction
    });
    logger.info(`Updated feed activity ${activityId} for like`);
  } else {
    // Create new activity
    const activity: FeedActivity = {
      id: activityId,
      postId,
      postAuthorId,
      fromUserId: likerId,
      fromUserName: likerName,
      fromUserPhoto: likerPhoto,
      liked: true,
      commented: false,
      commentCount: 0,
      lastInteractionAt: now,
      createdAt: now,
      read: false,
    };
    await activityRef.set(activity);
    logger.info(`Created feed activity ${activityId} for like`);
  }
}

/**
 * Handle unlike - update or delete feed activity
 */
async function handleUnlikeFeedActivity(
  postAuthorId: string,
  postId: string,
  likerId: string
): Promise<void> {
  const activityId = buildFeedActivityId(likerId, postId);
  const activityRef = db
    .collection("users")
    .doc(postAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const existingDoc = await activityRef.get();
  if (!existingDoc.exists) {
    logger.info(`No feed activity found for unlike: ${activityId}`);
    return;
  }

  const data = existingDoc.data() as FeedActivity;

  // If no comments, delete the activity entirely
  if (!data.commented || data.commentCount === 0) {
    await activityRef.delete();
    logger.info(`Deleted feed activity ${activityId} after unlike (no comments)`);
  } else {
    // Just update liked to false
    await activityRef.update({
      liked: false,
    });
    logger.info(`Updated feed activity ${activityId} - removed like, comments remain`);
  }
}

/**
 * Upsert a feed activity for a comment action
 */
async function upsertCommentFeedActivity(
  postAuthorId: string,
  postId: string,
  commenterId: string,
  commenterName: string,
  commenterPhoto: string | null
): Promise<void> {
  const activityId = buildFeedActivityId(commenterId, postId);
  const activityRef = db
    .collection("users")
    .doc(postAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const existingDoc = await activityRef.get();
  const now = Timestamp.now();

  if (existingDoc.exists) {
    // Update existing activity
    await activityRef.update({
      commented: true,
      commentCount: FieldValue.increment(1),
      lastInteractionAt: now,
      read: false, // Mark as unread on new interaction
    });
    logger.info(`Updated feed activity ${activityId} for comment`);
  } else {
    // Create new activity
    const activity: FeedActivity = {
      id: activityId,
      postId,
      postAuthorId,
      fromUserId: commenterId,
      fromUserName: commenterName,
      fromUserPhoto: commenterPhoto,
      liked: false,
      commented: true,
      commentCount: 1,
      lastInteractionAt: now,
      createdAt: now,
      read: false,
    };
    await activityRef.set(activity);
    logger.info(`Created feed activity ${activityId} for comment`);
  }
}

/**
 * Handle comment deletion - update or delete feed activity
 */
async function handleCommentDeleteFeedActivity(
  postAuthorId: string,
  postId: string,
  commenterId: string
): Promise<void> {
  const activityId = buildFeedActivityId(commenterId, postId);
  const activityRef = db
    .collection("users")
    .doc(postAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const existingDoc = await activityRef.get();
  if (!existingDoc.exists) {
    logger.info(`No feed activity found for comment delete: ${activityId}`);
    return;
  }

  const data = existingDoc.data() as FeedActivity;
  const newCommentCount = Math.max(0, data.commentCount - 1);

  // If no likes and no more comments, delete the activity entirely
  if (!data.liked && newCommentCount === 0) {
    await activityRef.delete();
    logger.info(`Deleted feed activity ${activityId} after comment delete (no interactions left)`);
  } else {
    // Update comment count and commented flag
    await activityRef.update({
      commentCount: newCommentCount,
      commented: newCommentCount > 0,
    });
    logger.info(`Updated feed activity ${activityId} - decremented comment count to ${newCommentCount}`);
  }
}

// ============================================================================
// Firebase Triggers
// ============================================================================

/**
 * Trigger: When a like is created on a post
 */
export const onPostLikeCreated = onDocumentCreated(
  {
    document: "posts/{postId}/likes/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, userId: likerId } = event.params;

    logger.info(`Like created on post ${postId} by user ${likerId}`);

    // Get post author
    const postAuthorId = await getPostAuthorId(postId);
    if (!postAuthorId) {
      logger.warn(`Post ${postId} not found, skipping feed activity`);
      return;
    }

    // Skip self-likes
    if (postAuthorId === likerId) {
      logger.info(`Skipping feed activity for self-like on post ${postId}`);
      return;
    }

    // Skip if users are blocked
    if (await areUsersBlocked(postAuthorId, likerId)) {
      logger.info(`Skipping feed activity: users ${postAuthorId} and ${likerId} are blocked`);
      return;
    }

    // Get liker info
    const likerInfo = await getUserDisplayInfo(likerId);

    // Create/update feed activity
    await upsertLikeFeedActivity(
      postAuthorId,
      postId,
      likerId,
      likerInfo.name,
      likerInfo.photo
    );
  }
);

/**
 * Trigger: When a like is deleted from a post
 */
export const onPostLikeDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}/likes/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, userId: likerId } = event.params;

    logger.info(`Like deleted on post ${postId} by user ${likerId}`);

    // Get post author
    const postAuthorId = await getPostAuthorId(postId);
    if (!postAuthorId) {
      logger.warn(`Post ${postId} not found, skipping feed activity cleanup`);
      return;
    }

    // Skip self-likes
    if (postAuthorId === likerId) {
      return;
    }

    // Handle unlike
    await handleUnlikeFeedActivity(postAuthorId, postId, likerId);
  }
);

/**
 * Trigger: When a comment is created on a post
 */
export const onPostCommentCreated = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, commentId } = event.params;
    const commentData = event.data?.data();

    if (!commentData) {
      logger.warn(`No comment data for ${commentId}`);
      return;
    }

    const commenterId = commentData.authorId;
    logger.info(`Comment ${commentId} created on post ${postId} by user ${commenterId}`);

    // Get post author
    const postAuthorId = await getPostAuthorId(postId);
    if (!postAuthorId) {
      logger.warn(`Post ${postId} not found, skipping feed activity`);
      return;
    }

    // Skip self-comments
    if (postAuthorId === commenterId) {
      logger.info(`Skipping feed activity for self-comment on post ${postId}`);
      return;
    }

    // Skip if users are blocked
    if (await areUsersBlocked(postAuthorId, commenterId)) {
      logger.info(`Skipping feed activity: users ${postAuthorId} and ${commenterId} are blocked`);
      return;
    }

    // Get commenter info
    const commenterInfo = await getUserDisplayInfo(commenterId);

    // Create/update feed activity
    await upsertCommentFeedActivity(
      postAuthorId,
      postId,
      commenterId,
      commenterInfo.name,
      commenterInfo.photo
    );
  }
);

/**
 * Trigger: When a comment is deleted from a post
 */
export const onPostCommentDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}/comments/{commentId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, commentId } = event.params;
    const commentData = event.data?.data();

    if (!commentData) {
      logger.warn(`No comment data for deleted comment ${commentId}`);
      return;
    }

    const commenterId = commentData.authorId;
    logger.info(`Comment ${commentId} deleted on post ${postId} by user ${commenterId}`);

    // Get post author
    const postAuthorId = await getPostAuthorId(postId);
    if (!postAuthorId) {
      logger.warn(`Post ${postId} not found, skipping feed activity cleanup`);
      return;
    }

    // Skip self-comments
    if (postAuthorId === commenterId) {
      return;
    }

    // Handle comment deletion
    await handleCommentDeleteFeedActivity(postAuthorId, postId, commenterId);
  }
);

// ============================================================================
// Comment Like Triggers
// ============================================================================

/**
 * Upsert a feed activity for a comment like action
 * Notifies the comment author that someone liked their comment
 */
async function upsertCommentLikeFeedActivity(
  commentAuthorId: string,
  postId: string,
  commentId: string,
  likerId: string,
  likerName: string,
  likerPhoto: string | null
): Promise<void> {
  // Use a different ID pattern to distinguish from post activities
  const activityId = `comment_${likerId}_${commentId}`;
  const activityRef = db
    .collection("users")
    .doc(commentAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const now = Timestamp.now();

  // For comment likes, we just create/update a simple activity
  const existingDoc = await activityRef.get();

  if (existingDoc.exists) {
    await activityRef.update({
      lastInteractionAt: now,
      read: false,
    });
    logger.info(`Updated feed activity ${activityId} for comment like`);
  } else {
    const activity: FeedActivity = {
      id: activityId,
      postId,
      commentId, // Include comment ID for context
      postAuthorId: commentAuthorId, // The recipient is the comment author
      fromUserId: likerId,
      fromUserName: likerName,
      fromUserPhoto: likerPhoto,
      liked: true,
      commented: false,
      commentCount: 0,
      lastInteractionAt: now,
      createdAt: now,
      read: false,
      isCommentLike: true, // Flag to distinguish from post likes
    };
    await activityRef.set(activity);
    logger.info(`Created feed activity ${activityId} for comment like`);
  }
}

/**
 * Handle comment unlike - delete the feed activity
 */
async function handleCommentUnlikeFeedActivity(
  commentAuthorId: string,
  commentId: string,
  likerId: string
): Promise<void> {
  const activityId = `comment_${likerId}_${commentId}`;
  const activityRef = db
    .collection("users")
    .doc(commentAuthorId)
    .collection("feedActivities")
    .doc(activityId);

  const existingDoc = await activityRef.get();
  if (!existingDoc.exists) {
    logger.info(`No feed activity found for comment unlike: ${activityId}`);
    return;
  }

  await activityRef.delete();
  logger.info(`Deleted feed activity ${activityId} after comment unlike`);
}

/**
 * Trigger: When a like is created on a comment
 */
export const onCommentLikeCreated = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}/likes/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, commentId, userId: likerId } = event.params;

    logger.info(`Like created on comment ${commentId} (post ${postId}) by user ${likerId}`);

    // Get comment author
    const commentAuthorId = await getCommentAuthorId(postId, commentId);
    if (!commentAuthorId) {
      logger.warn(`Comment ${commentId} not found, skipping feed activity`);
      return;
    }

    // Skip self-likes
    if (commentAuthorId === likerId) {
      logger.info(`Skipping feed activity for self-like on comment ${commentId}`);
      return;
    }

    // Skip if users are blocked
    if (await areUsersBlocked(commentAuthorId, likerId)) {
      logger.info(`Skipping feed activity: users ${commentAuthorId} and ${likerId} are blocked`);
      return;
    }

    // Get liker info
    const likerInfo = await getUserDisplayInfo(likerId);

    // Create feed activity
    await upsertCommentLikeFeedActivity(
      commentAuthorId,
      postId,
      commentId,
      likerId,
      likerInfo.name,
      likerInfo.photo
    );
  }
);

/**
 * Trigger: When a like is deleted from a comment
 */
export const onCommentLikeDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}/comments/{commentId}/likes/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const { postId, commentId, userId: likerId } = event.params;

    logger.info(`Like deleted on comment ${commentId} (post ${postId}) by user ${likerId}`);

    // Get comment author
    const commentAuthorId = await getCommentAuthorId(postId, commentId);
    if (!commentAuthorId) {
      logger.warn(`Comment ${commentId} not found, skipping feed activity cleanup`);
      return;
    }

    // Skip self-likes
    if (commentAuthorId === likerId) {
      return;
    }

    // Handle unlike
    await handleCommentUnlikeFeedActivity(commentAuthorId, commentId, likerId);
  }
);
