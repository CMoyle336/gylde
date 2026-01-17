/**
 * Account management Cloud Functions
 * Handles account disable/enable/delete operations
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {db, bucket} from "../config/firebase";
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

    return {success: true};
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

    return {success: true};
  } catch (error) {
    logger.error("Error enabling account:", error);
    throw new HttpsError("internal", "Failed to enable account");
  }
});

/**
 * Helper to delete all documents in a collection
 */
async function deleteCollection(collectionRef: FirebaseFirestore.CollectionReference): Promise<number> {
  const snapshot = await collectionRef.get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count++;

    // Firestore batches are limited to 500 operations
    if (count % 450 === 0) {
      await batch.commit();
    }
  }

  if (count % 450 !== 0) {
    await batch.commit();
  }

  return count;
}

/**
 * Helper to delete subcollections of a document
 */
async function deleteSubcollections(docRef: FirebaseFirestore.DocumentReference, subcollections: string[]): Promise<void> {
  for (const subcollectionName of subcollections) {
    const collectionRef = docRef.collection(subcollectionName);
    const count = await deleteCollection(collectionRef);
    if (count > 0) {
      logger.info(`Deleted ${count} documents from ${subcollectionName}`);
    }
  }
}

/**
 * Permanently delete a user's account and all associated data
 * This is a destructive operation that cannot be undone.
 *
 * Deletes:
 * - All user subcollections (favorites, blocks, activities, photo access, etc.)
 * - All conversations where user is a participant (and their messages)
 * - All user photos from Storage
 * - References to user in other users' data (favorites, photo access)
 * - The user document from Firestore
 * - The user from Firebase Auth
 */
export const deleteAccount = onCall(
  {
    timeoutSeconds: 300, // 5 minutes - this can take a while
    memory: "512MiB",
  },
  async (request) => {
    // Verify user is authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be authenticated to delete account");
    }

    const userId = request.auth.uid;
    logger.info(`Starting account deletion for user ${userId}`);

    try {
      const userRef = db.collection("users").doc(userId);

      // 1. Delete user's subcollections
      logger.info(`[${userId}] Deleting user subcollections...`);
      const userSubcollections = [
        "favorites",
        "blocks",
        "blockedBy",
        "activities",
        "photoAccessGrants",
        "photoAccessRequests",
        "photoAccessReceived",
      ];
      await deleteSubcollections(userRef, userSubcollections);

      // Delete private subcollection and its nested subcollections
      const privateDocRef = userRef.collection("private").doc("data");
      await privateDocRef.delete().catch(() => {}); // May not exist

      const virtualPhoneDocRef = userRef.collection("private").doc("virtualPhone");
      await deleteSubcollections(virtualPhoneDocRef, ["callLogs", "messageLogs"]);
      await virtualPhoneDocRef.delete().catch(() => {}); // May not exist

      // 2. Find and delete all conversations where user is a participant
      logger.info(`[${userId}] Deleting conversations and messages...`);
      const conversationsQuery = await db.collection("conversations")
        .where("participants", "array-contains", userId)
        .get();

      for (const convDoc of conversationsQuery.docs) {
        // Delete all messages in the conversation
        const messagesRef = convDoc.ref.collection("messages");
        await deleteCollection(messagesRef);

        // Delete conversation images from storage
        const convImagesPrefix = `conversations/${convDoc.id}/images/`;
        try {
          const [files] = await bucket.getFiles({prefix: convImagesPrefix});
          for (const file of files) {
            await file.delete().catch(() => {});
          }
          if (files.length > 0) {
            logger.info(`[${userId}] Deleted ${files.length} conversation images`);
          }
        } catch (error) {
          logger.warn(`[${userId}] Error deleting conversation images:`, error);
        }

        // Delete the conversation document
        await convDoc.ref.delete();
      }
      logger.info(`[${userId}] Deleted ${conversationsQuery.size} conversations`);

      // 3. Delete user's photos from Storage
      logger.info(`[${userId}] Deleting user storage files...`);
      const userStoragePrefix = `users/${userId}/`;
      try {
        const [files] = await bucket.getFiles({prefix: userStoragePrefix});
        for (const file of files) {
          await file.delete().catch(() => {});
        }
        logger.info(`[${userId}] Deleted ${files.length} files from storage`);
      } catch (error) {
        logger.warn(`[${userId}] Error deleting storage files:`, error);
      }

      // 4. Remove user from other users' favorites
      logger.info(`[${userId}] Removing from other users' favorites...`);
      const favoritedByQuery = await db.collectionGroup("favorites")
        .where("favoritedUserId", "==", userId)
        .get();

      for (const favDoc of favoritedByQuery.docs) {
        await favDoc.ref.delete();
      }
      if (favoritedByQuery.size > 0) {
        logger.info(`[${userId}] Removed from ${favoritedByQuery.size} users' favorites`);
      }

      // 5. Remove photo access grants/requests where user was involved
      logger.info(`[${userId}] Cleaning up photo access records...`);

      // Remove requests from this user (where they were the requester)
      const requestsFromUserQuery = await db.collectionGroup("photoAccessRequests")
        .where("requesterId", "==", userId)
        .get();
      for (const doc of requestsFromUserQuery.docs) {
        await doc.ref.delete();
      }

      // Note: photoAccessGrants and photoAccessReceived use userId as doc ID
      // These can't be efficiently queried via collectionGroup, so we rely on
      // the user's own subcollection deletion above. The orphaned documents
      // in other users' collections will be cleaned up when those users are deleted
      // or can be handled by a periodic cleanup job.

      // 6. Remove user from other users' blocks/blockedBy
      logger.info(`[${userId}] Cleaning up block records...`);
      const blocksOnUserQuery = await db.collectionGroup("blocks")
        .where("blockedUserId", "==", userId)
        .get();
      for (const doc of blocksOnUserQuery.docs) {
        await doc.ref.delete();
      }

      const blockedByUserQuery = await db.collectionGroup("blockedBy")
        .where("blockedByUserId", "==", userId)
        .get();
      for (const doc of blockedByUserQuery.docs) {
        await doc.ref.delete();
      }

      // 7. Remove activities in other users' feeds where deleted user was the actor
      logger.info(`[${userId}] Cleaning up activity records...`);
      const activitiesFromUserQuery = await db.collectionGroup("activities")
        .where("fromUserId", "==", userId)
        .get();
      for (const doc of activitiesFromUserQuery.docs) {
        await doc.ref.delete();
      }
      if (activitiesFromUserQuery.size > 0) {
        logger.info(`[${userId}] Deleted ${activitiesFromUserQuery.size} activities from other users' feeds`);
      }

      // 8. Delete the user document from Firestore
      logger.info(`[${userId}] Deleting user document...`);
      await userRef.delete();

      // 9. Delete the user from Firebase Auth
      logger.info(`[${userId}] Deleting Firebase Auth user...`);
      try {
        await getAuth().deleteUser(userId);
        logger.info(`[${userId}] Firebase Auth user deleted`);
      } catch (authError) {
        logger.error(`[${userId}] Error deleting Firebase Auth user:`, authError);
        // Don't throw - the Firestore data is already deleted
      }

      logger.info(`Account deletion completed for user ${userId}`);
      return {success: true};
    } catch (error) {
      logger.error(`Error deleting account for user ${userId}:`, error);
      throw new HttpsError("internal", "Failed to delete account. Please try again or contact support.");
    }
  }
);
