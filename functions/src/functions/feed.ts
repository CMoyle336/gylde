/**
 * Social Feed Cloud Functions
 *
 * Architecture:
 * - Public posts: Query-based (Explore feed)
 * - Connections/Private posts: Fanout-based (Home feed via feedItems)
 *
 * Handles:
 * - Creating posts (text + photos)
 * - Post fanout to feedItems for connections/private visibility
 * - Like/unlike posts
 * - Comment operations
 * - Post deletion
 * - Private access management
 */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {getConfig} from "../config/remote-config";
import * as logger from "firebase-functions/logger";

// ============================================================================
// Types
// ============================================================================

type PostVisibility = "public" | "connections" | "private";
type PostContentType = "text" | "image" | "video";
type PostStatus = "active" | "flagged" | "removed";
type CommentStatus = "active" | "removed";
type ReputationTier = "new" | "active" | "established" | "trusted" | "distinguished";
type FeedItemReason = "connection" | "approved" | "systemBoost";
type PrivateAccessGrantType = "author" | "request";

interface ViewerPolicy {
  minTier: ReputationTier;
  verifiedOnly: boolean;
  regionId: string;
}

type MediaType = "image" | "video";

interface PostMedia {
  url: string;
  type: MediaType;
  thumbUrl?: string;
  width?: number;
  height?: number;
  blurHash?: string;
  duration?: number; // For videos, in seconds
}

interface PostContent {
  type: PostContentType;
  text?: string;
  media?: PostMedia[];
}

interface PostMetrics {
  likeCount: number;
  commentCount: number;
  reportCount: number;
}

interface Post {
  id: string;
  authorId: string;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
  visibility: PostVisibility;
  viewerPolicy: ViewerPolicy;
  content: PostContent;
  metrics: PostMetrics;
  authorTier: ReputationTier;
  authorVerified: boolean;
  regionId: string;
  status: PostStatus;
}

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
  reason: FeedItemReason;
  visibility: PostVisibility;
  regionId: string;
  preview: FeedItemPreview;
}

interface PrivateAccess {
  viewerId: string;
  approvedAt: FieldValue | Timestamp;
  grantedBy: PrivateAccessGrantType;
}

interface PostComment {
  id: string;
  authorId: string;
  content: string;
  createdAt: FieldValue | Timestamp;
  status: CommentStatus;
}

interface UserProfile {
  displayName?: string;
  photoURL?: string;
  regionId?: string;
  identityVerified?: boolean;
  reputationTier?: ReputationTier;
  onboarding?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

interface PrivateUserData {
  trust?: {
    isIdentityVerified?: boolean;
  };
  reputation?: {
    tier?: ReputationTier;
  };
}

// ============================================================================
// Constants
// ============================================================================

const MAX_TEXT_LENGTH = 500;
const MAX_COMMENT_LENGTH = 280;
const MAX_MEDIA_ITEMS = 4;
const EXCERPT_LENGTH = 100;
const BACKFILL_LIMIT = 20; // Number of posts to backfill on connection/approval

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if two users are blocked (either direction)
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  const [blocked1, blocked2] = await Promise.all([
    db.collection("users").doc(userId1).collection("blocks").doc(userId2).get(),
    db.collection("users").doc(userId2).collection("blocks").doc(userId1).get(),
  ]);
  return blocked1.exists || blocked2.exists;
}

/**
 * Get user profile and private data
 */
async function getUserInfo(userId: string): Promise<{
  profile: UserProfile | null;
  private: PrivateUserData | null;
}> {
  const [profileDoc, privateDoc] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("users").doc(userId).collection("private").doc("data").get(),
  ]);

  return {
    profile: profileDoc.exists ? (profileDoc.data() as UserProfile) : null,
    private: privateDoc.exists ? (privateDoc.data() as PrivateUserData) : null,
  };
}

/**
 * Check if feed feature is enabled
 */
async function isFeedEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.feature_feed_enabled;
}

/**
 * Create a feed item for a user's home feed
 */
function createFeedItem(
  post: Post,
  authorName: string,
  authorPhotoURL: string | undefined,
  reason: FeedItemReason
): FeedItem {
  const contentExcerpt = post.content.text?.substring(0, EXCERPT_LENGTH) || "";
  const hasMedia = (post.content.media?.length || 0) > 0;

  return {
    postId: post.id,
    authorId: post.authorId,
    createdAt: post.createdAt,
    insertedAt: FieldValue.serverTimestamp(),
    reason,
    visibility: post.visibility,
    regionId: post.regionId,
    preview: {
      authorName,
      ...(authorPhotoURL && {authorPhotoURL}),
      contentExcerpt,
      hasMedia,
    },
  };
}

/**
 * Fanout a post to users' feedItems collections
 */
async function fanoutToFeedItems(
  post: Post,
  recipientIds: string[],
  authorName: string,
  authorPhotoURL: string | undefined,
  reason: FeedItemReason
): Promise<void> {
  if (recipientIds.length === 0) return;

  const bulkWriter = db.bulkWriter();
  const feedItem = createFeedItem(post, authorName, authorPhotoURL, reason);

  for (const recipientId of recipientIds) {
    // Use postId as doc ID for idempotent writes
    const feedItemRef = db
      .collection("users")
      .doc(recipientId)
      .collection("feedItems")
      .doc(post.id);

    bulkWriter.set(feedItemRef, feedItem);
  }

  await bulkWriter.close();
  logger.info(`Fanned out post ${post.id} to ${recipientIds.length} users`);
}

/**
 * Get all connections (matches) for a user
 */
async function getUserConnections(userId: string): Promise<string[]> {
  // Query matches where user is a participant
  const matchesSnapshot = await db
    .collection("matches")
    .where("users", "array-contains", userId)
    .get();

  const connectionIds: string[] = [];
  for (const doc of matchesSnapshot.docs) {
    const users = doc.data().users as string[];
    const otherId = users.find((id) => id !== userId);
    if (otherId) {
      connectionIds.push(otherId);
    }
  }

  return connectionIds;
}

/**
 * Get all users with private access to an author's posts
 */
async function getPrivateAccessViewers(authorId: string): Promise<string[]> {
  const accessSnapshot = await db
    .collection("users")
    .doc(authorId)
    .collection("privateAccess")
    .get();

  return accessSnapshot.docs.map((doc) => doc.id);
}

// ============================================================================
// Callable Functions
// ============================================================================

/**
 * Create a new post
 */
export const createPost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to create post");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {content, visibility = "public", viewerPolicy: clientViewerPolicy} = request.data as {
    content: PostContent;
    visibility?: PostVisibility;
    viewerPolicy?: Partial<ViewerPolicy>;
  };

  // Validate content
  if (!content || !content.type) {
    throw new HttpsError("invalid-argument", "Content with type is required");
  }

  if (content.text && content.text.length > MAX_TEXT_LENGTH) {
    throw new HttpsError("invalid-argument", `Text must be ${MAX_TEXT_LENGTH} characters or less`);
  }

  if (content.media && content.media.length > MAX_MEDIA_ITEMS) {
    throw new HttpsError("invalid-argument", `Maximum ${MAX_MEDIA_ITEMS} media items allowed`);
  }

  // Get user info
  const userInfo = await getUserInfo(userId);
  if (!userInfo.profile?.regionId) {
    throw new HttpsError("failed-precondition", "User profile must be completed before posting");
  }

  const authorTier = userInfo.private?.reputation?.tier || "new";
  const authorVerified = userInfo.profile.identityVerified === true;
  const regionId = userInfo.profile.regionId;

  // Build viewer policy with defaults
  const viewerPolicy: ViewerPolicy = {
    minTier: clientViewerPolicy?.minTier || "new",
    verifiedOnly: clientViewerPolicy?.verifiedOnly || false,
    regionId: clientViewerPolicy?.regionId || regionId,
  };

  // Create post document
  const postRef = db.collection("posts").doc();
  const post: Post = {
    id: postRef.id,
    authorId: userId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    visibility,
    viewerPolicy,
    content,
    metrics: {
      likeCount: 0,
      commentCount: 0,
      reportCount: 0,
    },
    authorTier,
    authorVerified,
    regionId,
    status: "active",
  };

  await postRef.set(post);

  logger.info(`Post ${postRef.id} created by user ${userId} with visibility ${visibility}`);

  return {
    success: true,
    postId: postRef.id,
  };
});

/**
 * Trigger: When a post is created, fanout to feedItems
 * - Public posts: Fanout to connections so they appear in "Connections" filter
 * - Connections posts: Fanout to connections
 * - Private posts: Fanout to approved viewers
 */
export const onPostCreated = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: "us-central1",
  },
  async (event) => {
    const postId = event.params.postId;
    const postData = event.data?.data() as Post | undefined;

    if (!postData) {
      logger.warn(`No data for new post: ${postId}`);
      return;
    }

    // Get author info for preview
    const authorInfo = await getUserInfo(postData.authorId);
    const authorName = authorInfo.profile?.displayName || "Unknown";
    const authorPhotoURL = authorInfo.profile?.photoURL;

    let recipientIds: string[] = [];
    let reason: FeedItemReason = "connection";

    if (postData.visibility === "public" || postData.visibility === "connections") {
      // Fanout to all connections (matches)
      // For public posts, this enables the "Connections" filter on the client
      // For connections posts, this is the only way they're distributed
      recipientIds = await getUserConnections(postData.authorId);
      reason = "connection";
      logger.info(`Post ${postId} (${postData.visibility}) fanning out to ${recipientIds.length} connections`);
    } else if (postData.visibility === "private") {
      // Fanout to approved viewers only
      recipientIds = await getPrivateAccessViewers(postData.authorId);
      reason = "approved";
      logger.info(`Post ${postId} (private) fanning out to ${recipientIds.length} approved viewers`);
    }

    // Always include the author so they can see their own posts in filtered views
    // (connections/private posts wouldn't otherwise appear in the author's feed)
    if (!recipientIds.includes(postData.authorId)) {
      recipientIds.push(postData.authorId);
      logger.info(`Including author ${postData.authorId} in fanout for their own post`);
    }

    if (recipientIds.length > 0) {
      await fanoutToFeedItems(postData, recipientIds, authorName, authorPhotoURL, reason);
    } else {
      logger.info(`Post ${postId} has no recipients for visibility ${postData.visibility}`);
    }
  }
);

/**
 * Grant private access to a viewer
 */
export const grantPrivateAccess = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const authorId = request.auth.uid;
  const {viewerId} = request.data as {viewerId: string};

  if (!viewerId) {
    throw new HttpsError("invalid-argument", "Viewer ID is required");
  }

  if (viewerId === authorId) {
    throw new HttpsError("invalid-argument", "Cannot grant access to yourself");
  }

  // Check if already granted
  const accessRef = db
    .collection("users")
    .doc(authorId)
    .collection("privateAccess")
    .doc(viewerId);

  const existingAccess = await accessRef.get();
  if (existingAccess.exists) {
    return {success: true, alreadyGranted: true};
  }

  const access: PrivateAccess = {
    viewerId,
    approvedAt: FieldValue.serverTimestamp(),
    grantedBy: "author",
  };

  await accessRef.set(access);

  logger.info(`User ${authorId} granted private access to ${viewerId}`);

  return {success: true};
});

/**
 * Revoke private access from a viewer
 */
export const revokePrivateAccess = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const authorId = request.auth.uid;
  const {viewerId} = request.data as {viewerId: string};

  if (!viewerId) {
    throw new HttpsError("invalid-argument", "Viewer ID is required");
  }

  await db
    .collection("users")
    .doc(authorId)
    .collection("privateAccess")
    .doc(viewerId)
    .delete();

  // Note: We don't remove existing feedItems - they become stale but are filtered on read
  // A cleanup job could remove them periodically

  logger.info(`User ${authorId} revoked private access from ${viewerId}`);

  return {success: true};
});

/**
 * Trigger: When private access is granted, backfill recent private posts
 */
export const onPrivateAccessCreated = onDocumentCreated(
  {
    document: "users/{authorId}/privateAccess/{viewerId}",
    region: "us-central1",
  },
  async (event) => {
    const {authorId, viewerId} = event.params;

    // Get recent private posts from author
    const postsSnapshot = await db
      .collection("posts")
      .where("authorId", "==", authorId)
      .where("visibility", "==", "private")
      .where("status", "==", "active")
      .orderBy("createdAt", "desc")
      .limit(BACKFILL_LIMIT)
      .get();

    if (postsSnapshot.empty) {
      logger.info(`No private posts to backfill for ${viewerId} from ${authorId}`);
      return;
    }

    // Get author info for preview
    const authorInfo = await getUserInfo(authorId);
    const authorName = authorInfo.profile?.displayName || "Unknown";
    const authorPhotoURL = authorInfo.profile?.photoURL;

    const posts = postsSnapshot.docs.map((doc) => doc.data() as Post);
    await fanoutToFeedItems(posts[0], [viewerId], authorName, authorPhotoURL, "approved");

    // Backfill all posts
    const bulkWriter = db.bulkWriter();
    for (const post of posts) {
      const feedItem = createFeedItem(post, authorName, authorPhotoURL, "approved");
      const feedItemRef = db
        .collection("users")
        .doc(viewerId)
        .collection("feedItems")
        .doc(post.id);
      bulkWriter.set(feedItemRef, feedItem);
    }
    await bulkWriter.close();

    logger.info(`Backfilled ${posts.length} private posts for ${viewerId} from ${authorId}`);
  }
);

/**
 * Like a post
 */
export const likePost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to like posts");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId} = request.data as {postId: string};

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  const postRef = db.collection("posts").doc(postId);
  const likeRef = postRef.collection("likes").doc(userId);

  const postDoc = await postRef.get();
  if (!postDoc.exists) {
    throw new HttpsError("not-found", "Post not found");
  }

  const postData = postDoc.data() as Post;

  if (postData.authorId !== userId) {
    const blocked = await areUsersBlocked(userId, postData.authorId);
    if (blocked) {
      throw new HttpsError("permission-denied", "Cannot like this post");
    }
  }

  const likeDoc = await likeRef.get();
  if (likeDoc.exists) {
    return {success: true, liked: true};
  }

  const batch = db.batch();
  batch.set(likeRef, {
    userId,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(postRef, {
    "metrics.likeCount": FieldValue.increment(1),
  });
  await batch.commit();

  logger.info(`User ${userId} liked post ${postId}`);

  return {success: true, liked: true};
});

/**
 * Unlike a post
 */
export const unlikePost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to unlike posts");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId} = request.data as {postId: string};

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  const postRef = db.collection("posts").doc(postId);
  const likeRef = postRef.collection("likes").doc(userId);

  const likeDoc = await likeRef.get();
  if (!likeDoc.exists) {
    return {success: true, liked: false};
  }

  const batch = db.batch();
  batch.delete(likeRef);
  batch.update(postRef, {
    "metrics.likeCount": FieldValue.increment(-1),
  });
  await batch.commit();

  logger.info(`User ${userId} unliked post ${postId}`);

  return {success: true, liked: false};
});

/**
 * Add a comment to a post
 */
export const addComment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to comment");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId, content} = request.data as {postId: string; content: string};

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  if (!content || typeof content !== "string") {
    throw new HttpsError("invalid-argument", "Comment content is required");
  }

  if (content.length > MAX_COMMENT_LENGTH) {
    throw new HttpsError("invalid-argument", `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }

  const postRef = db.collection("posts").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    throw new HttpsError("not-found", "Post not found");
  }

  const postData = postDoc.data() as Post;

  if (postData.authorId !== userId) {
    const blocked = await areUsersBlocked(userId, postData.authorId);
    if (blocked) {
      throw new HttpsError("permission-denied", "Cannot comment on this post");
    }
  }

  const commentRef = postRef.collection("comments").doc();
  const comment: PostComment = {
    id: commentRef.id,
    authorId: userId,
    content: content.trim(),
    createdAt: FieldValue.serverTimestamp(),
    status: "active",
  };

  const batch = db.batch();
  batch.set(commentRef, comment);
  batch.update(postRef, {
    "metrics.commentCount": FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  logger.info(`User ${userId} commented on post ${postId}`);

  return {
    success: true,
    commentId: commentRef.id,
  };
});

/**
 * Get comments for a post
 */
export const getPostComments = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to view comments");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId, limit = 20, cursor} = request.data as {
    postId: string;
    limit?: number;
    cursor?: string;
  };

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  const pageSize = Math.min(limit, 50);

  let query = db
    .collection("posts")
    .doc(postId)
    .collection("comments")
    .where("status", "==", "active")
    .orderBy("createdAt", "asc")
    .limit(pageSize + 1);

  if (cursor) {
    const cursorDoc = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(cursor)
      .get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();

  const comments: Array<{
    id: string;
    author: {
      uid: string;
      displayName: string | null;
      photoURL: string | null;
      reputationTier?: string;
    };
    content: string;
    createdAt: Date;
    isOwn: boolean;
  }> = [];

  for (const doc of snapshot.docs) {
    if (comments.length >= pageSize) break;

    const commentData = doc.data() as PostComment;
    const authorInfo = await getUserInfo(commentData.authorId);
    const createdAt = commentData.createdAt as Timestamp;

    comments.push({
      id: doc.id,
      author: {
        uid: commentData.authorId,
        displayName: authorInfo.profile?.displayName || null,
        photoURL: authorInfo.profile?.photoURL || null,
        reputationTier: authorInfo.private?.reputation?.tier,
      },
      content: commentData.content,
      createdAt: createdAt?.toDate() || new Date(),
      isOwn: commentData.authorId === userId,
    });
  }

  const hasMore = snapshot.docs.length > pageSize;
  const nextCursor = comments.length > 0 ? comments[comments.length - 1].id : null;

  return {
    comments,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };
});

/**
 * Delete a comment
 */
export const deleteComment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to delete comments");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId, commentId} = request.data as {postId: string; commentId: string};

  if (!postId || !commentId) {
    throw new HttpsError("invalid-argument", "Post ID and Comment ID are required");
  }

  const commentRef = db.collection("posts").doc(postId).collection("comments").doc(commentId);
  const commentDoc = await commentRef.get();

  if (!commentDoc.exists) {
    throw new HttpsError("not-found", "Comment not found");
  }

  const commentData = commentDoc.data() as PostComment;

  if (commentData.authorId !== userId) {
    throw new HttpsError("permission-denied", "Can only delete your own comments");
  }

  const postRef = db.collection("posts").doc(postId);
  const batch = db.batch();
  batch.update(commentRef, {status: "removed"});
  batch.update(postRef, {
    "metrics.commentCount": FieldValue.increment(-1),
  });
  await batch.commit();

  logger.info(`User ${userId} deleted comment ${commentId}`);

  return {success: true};
});

/**
 * Delete a post (soft delete)
 */
export const deletePost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to delete posts");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId} = request.data as {postId: string};

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  const postRef = db.collection("posts").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    throw new HttpsError("not-found", "Post not found");
  }

  const postData = postDoc.data() as Post;

  if (postData.authorId !== userId) {
    throw new HttpsError("permission-denied", "Can only delete your own posts");
  }

  await postRef.update({
    status: "removed",
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Note: feedItems are not removed - they become stale and are filtered on read
  // A cleanup job could remove them periodically

  logger.info(`User ${userId} deleted post ${postId}`);

  return {success: true};
});

/**
 * Report a post
 */
export const reportPost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to report posts");
  }

  if (!(await isFeedEnabled())) {
    throw new HttpsError("failed-precondition", "Feed feature is not enabled");
  }

  const userId = request.auth.uid;
  const {postId, reason} = request.data as {postId: string; reason?: string};

  if (!postId) {
    throw new HttpsError("invalid-argument", "Post ID is required");
  }

  const postRef = db.collection("posts").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    throw new HttpsError("not-found", "Post not found");
  }

  const postData = postDoc.data() as Post;

  if (postData.authorId === userId) {
    throw new HttpsError("invalid-argument", "Cannot report your own post");
  }

  const reportRef = postRef.collection("reports").doc(userId);
  const reportDoc = await reportRef.get();

  if (reportDoc.exists) {
    return {success: true, alreadyReported: true};
  }

  const batch = db.batch();
  batch.set(reportRef, {
    userId,
    reason: reason || "",
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(postRef, {
    "metrics.reportCount": FieldValue.increment(1),
  });
  await batch.commit();

  // Auto-flag posts with multiple reports
  const updatedPost = await postRef.get();
  const updatedData = updatedPost.data() as Post;
  if (updatedData.metrics.reportCount >= 3 && updatedData.status === "active") {
    await postRef.update({status: "flagged"});
    logger.warn(`Post ${postId} flagged due to multiple reports`);
  }

  logger.info(`User ${userId} reported post ${postId}`);

  return {success: true};
});
