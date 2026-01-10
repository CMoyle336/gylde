/**
 * Activity-related type definitions
 */
import { FieldValue } from "firebase-admin/firestore";

export type ActivityType = "favorite" | "match" | "message" | "view";

export interface ActivityBase {
  type: ActivityType;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  toUserId: string;
  read: boolean;
}

/**
 * Activity data for writing to Firestore (with server timestamp)
 */
export interface ActivityWrite extends ActivityBase {
  createdAt: FieldValue;
}
