/**
 * User Service
 * Handles user profile operations
 */
import { db } from "../config/firebase";
import { UserProfile, UserDisplayInfo } from "../types";
import * as logger from "firebase-functions/logger";

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
}
