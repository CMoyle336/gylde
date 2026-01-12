/**
 * Activity-related type definitions
 */
import { FieldValue } from "firebase-admin/firestore";

export type ActivityType = "favorite" | "match" | "message" | "view" | "photo_access_request" | "photo_access_granted" | "photo_access_denied";

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
 * Activity data for writing to Firestore (with server timestamp)
 */
export interface ActivityWrite extends ActivityBase {
  createdAt: FieldValue;
}
