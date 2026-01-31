/**
 * Activity Service
 * Handles creation and deletion of activity records
 */
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {ActivityType, ActivityWrite} from "../types";
import * as logger from "firebase-functions/logger";

export class ActivityService {
  /**
   * Check if two users have blocked each other (in either direction)
   */
  private static async areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
    // Check if userId1 blocked userId2
    const blockedDoc = await db
      .collection("users")
      .doc(userId1)
      .collection("blocks")
      .doc(userId2)
      .get();

    if (blockedDoc.exists) return true;

    // Check if userId2 blocked userId1
    const blockedByDoc = await db
      .collection("users")
      .doc(userId1)
      .collection("blockedBy")
      .doc(userId2)
      .get();

    return blockedByDoc.exists;
  }

  /**
   * Create an activity record for a user
   * @param link - Navigation link for the activity (null for activities that open dialogs instead)
   * Note: Will not create activity if users have blocked each other
   */
  static async createActivity(
    toUserId: string,
    type: ActivityType,
    fromUserId: string,
    fromUserName: string,
    fromUserPhoto: string | null,
    link: string | null = null
  ): Promise<string | null> {
    // Don't create activities between blocked users
    if (await this.areUsersBlocked(toUserId, fromUserId)) {
      logger.info(`Skipping activity ${type}: users ${toUserId} and ${fromUserId} are blocked`);
      return null;
    }

    const activityId = `${type}_${fromUserId}_${Date.now()}`;

    const activity: ActivityWrite = {
      type,
      fromUserId,
      fromUserName,
      fromUserPhoto,
      toUserId,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
      link,
    };

    await db
      .collection("users")
      .doc(toUserId)
      .collection("activities")
      .doc(activityId)
      .set(activity);

    logger.info(`Activity created: ${type} for user ${toUserId} from ${fromUserName}`);
    return activityId;
  }

  /**
   * Create or update an activity record (upsert).
   * If an activity of the same type from the same user already exists,
   * update it instead of creating a new one.
   * Useful for message activities to avoid duplicates.
   * @param link - Navigation link for the activity (null for activities that open dialogs instead)
   * Note: Will not create/update activity if users have blocked each other
   */
  static async upsertActivity(
    toUserId: string,
    type: ActivityType,
    fromUserId: string,
    fromUserName: string,
    fromUserPhoto: string | null,
    link: string | null = null
  ): Promise<string | null> {
    // Don't create/update activities between blocked users
    if (await this.areUsersBlocked(toUserId, fromUserId)) {
      logger.info(`Skipping activity upsert ${type}: users ${toUserId} and ${fromUserId} are blocked`);
      return null;
    }

    const activitiesRef = db
      .collection("users")
      .doc(toUserId)
      .collection("activities");

    // Check for existing activity of same type from same user
    const snapshot = await activitiesRef
      .where("type", "==", type)
      .where("fromUserId", "==", fromUserId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      // Update existing activity
      const existingDoc = snapshot.docs[0];
      await existingDoc.ref.update({
        fromUserName,
        fromUserPhoto,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
        link,
      });
      logger.info(`Activity updated: ${type} for user ${toUserId} from ${fromUserName}`);
      return existingDoc.id;
    }

    // Create new activity
    return this.createActivity(toUserId, type, fromUserId, fromUserName, fromUserPhoto, link);
  }

  /**
   * Delete activities matching criteria
   */
  static async deleteActivities(
    toUserId: string,
    type: ActivityType,
    fromUserId: string
  ): Promise<number> {
    const activitiesRef = db
      .collection("users")
      .doc(toUserId)
      .collection("activities");

    const snapshot = await activitiesRef
      .where("type", "==", type)
      .where("fromUserId", "==", fromUserId)
      .get();

    if (snapshot.empty) {
      logger.info(`No ${type} activities found to delete`);
      return 0;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    logger.info(`Deleted ${snapshot.size} ${type} activity(s) from ${fromUserId} to ${toUserId}`);
    return snapshot.size;
  }
}
