/**
 * Cloud Functions for profile view tracking
 */

import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/**
 * Check if a user has premium subscription
 */
async function isPremiumUser(userId: string): Promise<boolean> {
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();
  
  const tier = privateDoc.data()?.subscription?.tier;
  return tier === "premium";
}

/**
 * Trigger: When a profile view record is created
 * Creates or updates the corresponding activity record for the viewed user
 */
export const onProfileViewCreated = onDocumentCreated(
  "profileViews/{viewId}",
  async (event) => {
    const viewData = event.data?.data();
    if (!viewData) {
      logger.warn("No data in profile view document");
      return;
    }

    const {viewerId, viewerName, viewerPhoto, viewedUserId} = viewData;

    if (!viewerId || !viewedUserId) {
      logger.warn("Missing viewerId or viewedUserId in profile view");
      return;
    }

    logger.info(`Profile view: ${viewerName} (${viewerId}) viewed ${viewedUserId}`);

    try {
      // Only create view activities for premium users
      // (only premium users can see who viewed their profile)
      const viewedUserIsPremium = await isPremiumUser(viewedUserId);
      if (!viewedUserIsPremium) {
        logger.info(`Skipping view activity for ${viewedUserId} - not a premium user`);
        return;
      }

      const activitiesRef = db
        .collection("users")
        .doc(viewedUserId)
        .collection("activities");

      // Check for existing view activity from this user (upsert pattern)
      const existingActivity = await activitiesRef
        .where("type", "==", "view")
        .where("fromUserId", "==", viewerId)
        .limit(1)
        .get();

      if (!existingActivity.empty) {
        // Update existing activity (brings it to top of feed)
        await existingActivity.docs[0].ref.update({
          createdAt: FieldValue.serverTimestamp(),
          read: false,
          fromUserName: viewerName || "Someone",
          fromUserPhoto: viewerPhoto || null,
          link: `/user/${viewerId}`,
        });
        logger.info(`Updated existing view activity for ${viewedUserId}`);
      } else {
        // Create new view activity
        await activitiesRef.add({
          type: "view",
          fromUserId: viewerId,
          fromUserName: viewerName || "Someone",
          fromUserPhoto: viewerPhoto || null,
          toUserId: viewedUserId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          link: `/user/${viewerId}`,
        });
        logger.info(`Created new view activity for ${viewedUserId}`);
      }
    } catch (error) {
      logger.error("Error creating view activity:", error);
    }
  }
);
