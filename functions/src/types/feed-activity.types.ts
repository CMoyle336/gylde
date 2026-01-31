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
  id: string;                    // {fromUserId}_{postId}
  postId: string;
  postAuthorId: string;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  liked: boolean;                // Whether they liked the post
  commented: boolean;            // Whether they commented
  commentCount: number;          // Number of comments from this user
  lastInteractionAt: Timestamp;  // Most recent interaction
  createdAt: Timestamp;          // First interaction
  read: boolean;
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
