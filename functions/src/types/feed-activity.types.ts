/**
 * Feed Activity types for social interactions (likes, comments on posts)
 * Separate from profile activities (favorites, matches, views, messages)
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Feed Activity document stored in users/{postAuthorId}/feedActivities/{fromUserId}_{postId}
 * Tracks all interactions from a single user on a single post
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
  lastInteractionAt: Timestamp;  // Most recent interaction
  createdAt: Timestamp;          // First interaction
  read: boolean;
  
  // Optional fields for comment-specific activities
  commentId?: string;            // If this is a comment like activity
  isCommentLike?: boolean;       // True if this is a like on a comment (not a post)
}

/**
 * Data needed to create or update a feed activity
 */
export interface FeedActivityData {
  postId: string;
  postAuthorId: string;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
}
