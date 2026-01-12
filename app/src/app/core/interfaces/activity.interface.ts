/**
 * Activity types for the activity feed
 */

export type ActivityType = 'favorite' | 'match' | 'message' | 'view' | 'photo_access_request';

/**
 * Base activity record stored in Firestore
 */
export interface ActivityBase {
  type: ActivityType;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  toUserId: string;
  read: boolean;
  link?: string | null; // Navigation link for the activity (null for activities like photo_access_request that open dialogs)
}

/**
 * Activity record as stored in Firestore
 */
export interface Activity extends ActivityBase {
  id?: string;
  createdAt: unknown; // Timestamp on read
}

/**
 * Activity for display in the UI (with formatted time)
 */
export interface ActivityDisplay {
  id: string;
  type: ActivityType;
  fromUserId: string;
  name: string;
  photo: string | null;
  time: string;
  timeAgo: string;
  read: boolean;
  link?: string | null;
}
