/**
 * Feed Activity interfaces for social interactions (likes, comments on posts)
 * Separate from profile activities (favorites, matches, views, messages)
 */

/**
 * Feed Activity as stored in Firestore
 * Path: users/{postAuthorId}/feedActivities/{fromUserId}_{postId}
 */
export interface FeedActivity {
  id: string;                    // {fromUserId}_{postId} or comment_{fromUserId}_{commentId}
  postId: string;
  postAuthorId: string;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  liked: boolean;                // Whether they liked the post/comment
  commented: boolean;            // Whether they commented
  commentCount: number;          // Number of comments from this user
  lastInteractionAt: Date | unknown;  // Most recent interaction
  createdAt: Date | unknown;          // First interaction
  read: boolean;
  
  // Optional fields for comment-specific activities
  commentId?: string;            // If this is a comment like activity
  isCommentLike?: boolean;       // True if this is a like on a comment (not a post)
}

/**
 * Feed Activity for display in the UI (with formatted time)
 */
export interface FeedActivityDisplay {
  id: string;
  postId: string;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  liked: boolean;
  commented: boolean;
  commentCount: number;
  timeAgo: string;
  read: boolean;
  
  // Optional fields for comment-specific activities
  commentId?: string;
  isCommentLike?: boolean;
}
