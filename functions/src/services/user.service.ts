/**
 * User Service
 * Handles user profile operations
 */
import { db } from "../config/firebase";
import { UserProfile, UserDisplayInfo } from "../types";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export class UserService {
  /**
   * Get a user's profile data
   */
  static async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const doc = await db.collection("users").doc(userId).get();
      if (!doc.exists) {
        logger.warn(`User profile not found: ${userId}`);
        return null;
      }
      return doc.data() as UserProfile;
    } catch (error) {
      logger.error(`Error fetching user profile ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get display info for a user (name and photo)
   */
  static async getDisplayInfo(userId: string): Promise<UserDisplayInfo> {
    const profile = await this.getProfile(userId);
    return {
      displayName: profile?.displayName || "Someone",
      photoURL: profile?.photoURL || undefined,
    };
  }

  /**
   * Update user's last active timestamp and sortable version
   * sortableLastActive is set to lastActiveAt if user allows activity visibility, null otherwise
   */
  static async updateLastActive(userId: string): Promise<void> {
    try {
      const userRef = db.collection("users").doc(userId);
      const doc = await userRef.get();
      
      if (!doc.exists) {
        logger.warn(`Cannot update last active - user not found: ${userId}`);
        return;
      }

      const data = doc.data();
      const privacySettings = data?.settings?.privacy || {};
      const showOnlineStatus = privacySettings.showOnlineStatus !== false;
      const showLastActive = privacySettings.showLastActive !== false;
      const canShowActivity = showOnlineStatus || showLastActive;

      await userRef.update({
        lastActiveAt: FieldValue.serverTimestamp(),
        // Only set sortableLastActive if user allows showing activity
        sortableLastActive: canShowActivity ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info(`Updated last active for user ${userId}, sortable: ${canShowActivity}`);
    } catch (error) {
      logger.error(`Error updating last active for ${userId}:`, error);
    }
  }

  /**
   * Recalculate and update sortableLastActive based on current privacy settings
   * Called when privacy settings change
   */
  static async recalculateSortableLastActive(
    userId: string,
    showOnlineStatus: boolean,
    showLastActive: boolean,
    lastActiveAt: Timestamp | null
  ): Promise<void> {
    try {
      const userRef = db.collection("users").doc(userId);
      const canShowActivity = showOnlineStatus || showLastActive;

      await userRef.update({
        // If user allows activity visibility, use their lastActiveAt; otherwise null
        sortableLastActive: canShowActivity && lastActiveAt ? lastActiveAt : null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info(`Recalculated sortableLastActive for user ${userId}: ${canShowActivity ? 'visible' : 'hidden'}`);
    } catch (error) {
      logger.error(`Error recalculating sortableLastActive for ${userId}:`, error);
    }
  }
}
