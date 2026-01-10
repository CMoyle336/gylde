/**
 * Activity-related type definitions
 * Re-exports shared types and adds server-specific extensions
 */
import { FieldValue } from "firebase-admin/firestore";

// Re-export shared types
export { ActivityType, ActivityBase, Activity } from "@gylde/shared";

/**
 * Activity data for writing to Firestore (with server timestamp)
 */
export interface ActivityWrite {
  type: import("@gylde/shared").ActivityType;
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  toUserId: string;
  createdAt: FieldValue;
  read: boolean;
}
