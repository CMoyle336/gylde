/**
 * Activity types - shared between client and server
 */

export type ActivityType = 'like' | 'match' | 'message' | 'view';

/**
 * Base activity record stored in Firestore
 * Note: `createdAt` is FieldValue on write, Timestamp on read
 */
export interface ActivityBase {
  type: ActivityType;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  toUserId: string;
  read: boolean;
}

/**
 * Activity record as stored in Firestore (with server timestamp)
 */
export interface Activity extends ActivityBase {
  id?: string;
  createdAt: unknown; // FieldValue on write, Timestamp/Date on read
}

/**
 * Activity for display in the UI (with formatted time)
 */
export interface ActivityDisplay {
  id: string;
  type: ActivityType;
  name: string;
  photo: string | null;
  time: string;
  timeAgo: string;
  read: boolean;
}
