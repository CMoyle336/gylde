import { FieldValue } from '@angular/fire/firestore';
import { ReputationTier } from './reputation.interface';

/**
 * Post visibility options
 * - public: Visible to everyone in the user's region (query-based explore)
 * - connections: Visible to mutual matches (fanout-based)
 * - private: Visible only to approved users (fanout-based)
 */
export type PostVisibility = 'public' | 'connections' | 'private';

/**
 * Post content type
 */
export type PostContentType = 'text' | 'image' | 'video';

/**
 * Post moderation status
 */
export type PostStatus = 'active' | 'flagged' | 'removed';

/**
 * Viewer policy for controlling who can see a post
 */
export interface ViewerPolicy {
  /** Minimum reputation tier required to view */
  minTier: ReputationTier;
  /** Only verified users can view */
  verifiedOnly: boolean;
  /** Region ID for geographic filtering */
  regionId: string;
}

/**
 * Media type for posts
 */
export type MediaType = 'image' | 'video';

/**
 * Media item in a post
 */
export interface PostMedia {
  url: string;
  type: MediaType;
  thumbUrl?: string;
  width?: number;
  height?: number;
  blurHash?: string;
  /** Duration in seconds (for videos) */
  duration?: number;
}

/**
 * Post content structure
 */
export interface PostContent {
  type: PostContentType;
  text?: string;
  media?: PostMedia[];
}

/**
 * Post metrics (engagement counts)
 */
export interface PostMetrics {
  likeCount: number;
  commentCount: number;
  reportCount: number;
}

/**
 * A post in the social feed
 * Stored in: posts/{postId}
 */
export interface Post {
  // Identity
  id: string;
  authorId: string;
  
  // Timestamps
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
  
  // Visibility & Access Control
  visibility: PostVisibility;
  viewerPolicy: ViewerPolicy;
  
  // Content
  content: PostContent;
  
  // Metrics (denormalized, maintained by Cloud Functions)
  metrics: PostMetrics;
  
  // Denormalized for queries (maintained by Cloud Functions)
  authorTier: ReputationTier;
  authorVerified: boolean;
  regionId: string;  // e.g., "us-mi-detroit"
  
  // Status
  status: PostStatus;
}

/**
 * Reason a post appeared in user's home feed
 */
export type FeedItemReason = 'connection' | 'approved' | 'systemBoost';

/**
 * Preview data for a feed item (denormalized to avoid extra reads)
 */
export interface FeedItemPreview {
  authorName: string;
  authorPhotoURL?: string;
  contentExcerpt: string;  // First 100 chars of text
  hasMedia: boolean;
}

/**
 * A feed item in a user's home feed inbox
 * Stored in: users/{uid}/feedItems/{postId}
 * Doc ID = postId for idempotent writes
 */
export interface FeedItem {
  postId: string;           // Same as doc ID
  authorId: string;
  createdAt: Date | FieldValue;     // Post createdAt
  insertedAt: Date | FieldValue;    // When added to feed
  reason: FeedItemReason;
  visibility: PostVisibility;
  regionId: string;
  
  // Denormalized preview (avoid extra reads)
  preview: FeedItemPreview;
}

/**
 * Grant type for private access
 */
export type PrivateAccessGrantType = 'author' | 'request';

/**
 * Private access grant for viewing private posts
 * Stored in: users/{authorId}/privateAccess/{viewerId}
 */
export interface PrivateAccess {
  viewerId: string;
  approvedAt: Date | FieldValue;
  grantedBy: PrivateAccessGrantType;
}

/**
 * A like on a post
 * Stored in: posts/{postId}/likes/{userId}
 */
export interface PostLike {
  userId: string;
  createdAt: Date | FieldValue;
}

/**
 * Comment moderation status
 */
export type CommentStatus = 'active' | 'removed';

/**
 * A comment on a post
 * Stored in: posts/{postId}/comments/{commentId}
 */
export interface PostComment {
  id: string;
  authorId: string;
  content: string;           // Max 280 chars
  createdAt: Date | FieldValue;
  status: CommentStatus;
}

/**
 * Source of the post for filtering purposes
 */
export type PostSource = 'public' | 'connection' | 'private';

/**
 * Display-ready post for the UI
 * Includes author info and current user's interaction state
 */
export interface PostDisplay {
  id: string;
  
  // Author info (fetched from user profile)
  author: {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    reputationTier?: ReputationTier;
    isVerified?: boolean;
  };
  
  // Content
  content: PostContent;
  visibility: PostVisibility;
  
  // Engagement
  likeCount: number;
  commentCount: number;
  
  // Current user's state
  isLiked: boolean;          // Has current user liked this post?
  isOwn: boolean;            // Is current user the author?
  
  // Timestamps
  createdAt: Date;
  
  // Moderation
  status: PostStatus;
  
  // Source for filtering (how did this post reach the user's feed?)
  source?: PostSource;
}

/**
 * Display-ready comment for the UI
 */
export interface CommentDisplay {
  id: string;
  
  // Author info
  author: {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    reputationTier?: ReputationTier;
  };
  
  content: string;
  createdAt: Date;
  isOwn: boolean;            // Is current user the author?
}

/**
 * Request payload for creating a post
 */
export interface CreatePostRequest {
  content: PostContent;
  visibility?: PostVisibility;
  viewerPolicy?: Partial<ViewerPolicy>;
}

/**
 * Response from creating a post
 */
export interface CreatePostResponse {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Feed filter type for unified feed experience
 * - 'all': All posts (public in region + connections + private access)
 * - 'connections': Only posts from mutual favorites
 * - 'private': Only posts from users who granted private access
 */
export type FeedFilter = 'all' | 'connections' | 'private';

/**
 * @deprecated Use FeedFilter instead
 */
export type FeedSurface = 'explore' | 'home';

/**
 * Request payload for getting comments
 */
export interface GetCommentsRequest {
  postId: string;
  limit?: number;
  cursor?: string;
}

/**
 * Response from getting comments
 */
export interface GetCommentsResponse {
  comments: CommentDisplay[];
  nextCursor: string | null;
  hasMore: boolean;
}
