/**
 * Activity Service
 * Handles creation and deletion of activity records
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { ActivityType, ActivityWrite } from "../types";
import * as logger from "firebase-functions/logger";

export class ActivityService {
  /**
   * Create an activity record for a user
   */
  static async createActivity(
    toUserId: string,
    type: ActivityType,
    fromUserId: string,
    fromUserName: string,
    fromUserPhoto: string | null
  ): Promise<string> {
    const activityId = `${type}_${fromUserId}_${Date.now()}`;

    const activity: ActivityWrite = {
      type,
      fromUserId,
      fromUserName,
      fromUserPhoto,
      toUserId,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
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
