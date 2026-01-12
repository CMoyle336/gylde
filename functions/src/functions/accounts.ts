/**
 * Account management Cloud Functions
 * Handles account disable/enable operations
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import * as logger from "firebase-functions/logger";

/**
 * Disable a user's account
 * - Updates Firestore user document with disabled flag
 * - Hides profile from discovery
 * - User will be signed out on the client side
 */
export const disableAccount = onCall(async (request) => {
  // Verify user is authenticated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to disable account");
  }

  const userId = request.auth.uid;
  logger.info(`Disabling account for user ${userId}`);

  try {
    // Update Firestore user document
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      "settings.account.disabled": true,
      "settings.account.disabledAt": FieldValue.serverTimestamp(),
      "settings.privacy.profileVisible": false, // Hide from discovery
      "isSearchable": false, // Remove from search results
    });
    logger.info(`Disabled account for user ${userId}`);

    return { success: true };
  } catch (error) {
    logger.error("Error disabling account:", error);
    throw new HttpsError("internal", "Failed to disable account");
  }
});

/**
 * Enable a user's account
 * - Updates Firestore user document to remove disabled flag
 * - Restores profile visibility
 */
export const enableAccount = onCall(async (request) => {
  // Verify user is authenticated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to enable account");
  }

  const userId = request.auth.uid;
  logger.info(`Enabling account for user ${userId}`);

  try {
    // Update Firestore user document
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      "settings.account.disabled": false,
      "settings.account.disabledAt": FieldValue.delete(),
      "settings.privacy.profileVisible": true, // Show in discovery again
      "isSearchable": true, // Allow in search results
    });
    logger.info(`Enabled account for user ${userId}`);

    return { success: true };
  } catch (error) {
    logger.error("Error enabling account:", error);
    throw new HttpsError("internal", "Failed to enable account");
  }
});
