/**
 * Block User Cloud Functions
 * Handles blocking/unblocking users and related cleanup
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import * as logger from "firebase-functions/logger";

interface BlockRecord {
  blockedUserId: string;
  blockedByUserId: string;
  createdAt: FieldValue;
}

/**
 * Block a user
 * - Creates block records for both users (mutual block effect)
 * - Deletes all activity records between the two users
 * - Removes favorites between the two users
 * - Removes matches between the two users
 * - Removes profile views between the two users
 */
export const blockUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to block users");
  }

  const currentUserId = request.auth.uid;
  const { userId: targetUserId } = request.data as { userId: string };

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  if (currentUserId === targetUserId) {
    throw new HttpsError("invalid-argument", "Cannot block yourself");
  }

  logger.info(`User ${currentUserId} is blocking user ${targetUserId}`);

  const batch = db.batch();

  try {
    // 1. Create block record for the blocker
    // Store in both users' blocks subcollection for efficient querying
    const blockerBlockRef = db
      .collection("users")
      .doc(currentUserId)
      .collection("blocks")
      .doc(targetUserId);
    
    batch.set(blockerBlockRef, {
      blockedUserId: targetUserId,
      blockedByUserId: currentUserId,
      createdAt: FieldValue.serverTimestamp(),
    } as BlockRecord);

    // 2. Create reverse block record (so target can't see blocker either)
    const targetBlockRef = db
      .collection("users")
      .doc(targetUserId)
      .collection("blockedBy")
      .doc(currentUserId);
    
    batch.set(targetBlockRef, {
      blockedUserId: currentUserId,
      blockedByUserId: currentUserId,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    logger.info(`Created block records for ${currentUserId} -> ${targetUserId}`);

    // 3. Delete activity records between users (async, don't block response)
    deleteActivityBetweenUsers(currentUserId, targetUserId).catch(err => {
      logger.error("Error deleting activity:", err);
    });

    // 4. Delete favorites between users
    deleteFavoritesBetweenUsers(currentUserId, targetUserId).catch(err => {
      logger.error("Error deleting favorites:", err);
    });

    // 5. Delete matches between users
    deleteMatchesBetweenUsers(currentUserId, targetUserId).catch(err => {
      logger.error("Error deleting matches:", err);
    });

    // 6. Delete profile views between users
    deleteProfileViewsBetweenUsers(currentUserId, targetUserId).catch(err => {
      logger.error("Error deleting profile views:", err);
    });

    // 7. Delete photo access requests between users
    deletePhotoAccessBetweenUsers(currentUserId, targetUserId).catch(err => {
      logger.error("Error deleting photo access:", err);
    });

    return { success: true };
  } catch (error) {
    logger.error("Error blocking user:", error);
    throw new HttpsError("internal", "Failed to block user");
  }
});

/**
 * Unblock a user
 * - Removes block records
 * - Does NOT restore deleted data (activities, favorites, etc.)
 */
export const unblockUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to unblock users");
  }

  const currentUserId = request.auth.uid;
  const { userId: targetUserId } = request.data as { userId: string };

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  logger.info(`User ${currentUserId} is unblocking user ${targetUserId}`);

  const batch = db.batch();

  try {
    // Remove block record
    const blockerBlockRef = db
      .collection("users")
      .doc(currentUserId)
      .collection("blocks")
      .doc(targetUserId);
    batch.delete(blockerBlockRef);

    // Remove reverse block record
    const targetBlockRef = db
      .collection("users")
      .doc(targetUserId)
      .collection("blockedBy")
      .doc(currentUserId);
    batch.delete(targetBlockRef);

    await batch.commit();
    logger.info(`Removed block records for ${currentUserId} -> ${targetUserId}`);

    return { success: true };
  } catch (error) {
    logger.error("Error unblocking user:", error);
    throw new HttpsError("internal", "Failed to unblock user");
  }
});

/**
 * Get list of blocked user IDs for the current user
 * Returns both users they've blocked and users who have blocked them
 */
export const getBlockedUsers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const currentUserId = request.auth.uid;

  try {
    // Get users this user has blocked
    const blockedSnapshot = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blocks")
      .get();

    // Get users who have blocked this user
    const blockedBySnapshot = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blockedBy")
      .get();

    const blockedUserIds = blockedSnapshot.docs.map(doc => doc.id);
    const blockedByUserIds = blockedBySnapshot.docs.map(doc => doc.id);

    // Combine and deduplicate
    const allBlockedIds = [...new Set([...blockedUserIds, ...blockedByUserIds])];

    return { 
      blockedUserIds: allBlockedIds,
      blockedByMe: blockedUserIds,
      blockedMe: blockedByUserIds,
    };
  } catch (error) {
    logger.error("Error getting blocked users:", error);
    throw new HttpsError("internal", "Failed to get blocked users");
  }
});

/**
 * Check if a specific user is blocked (either direction)
 */
export const checkBlockStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const currentUserId = request.auth.uid;
  const { userId: targetUserId } = request.data as { userId: string };

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  try {
    // Check if current user blocked target
    const blockedDoc = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blocks")
      .doc(targetUserId)
      .get();

    // Check if target blocked current user
    const blockedByDoc = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blockedBy")
      .doc(targetUserId)
      .get();

    return {
      isBlocked: blockedDoc.exists || blockedByDoc.exists,
      blockedByMe: blockedDoc.exists,
      blockedMe: blockedByDoc.exists,
    };
  } catch (error) {
    logger.error("Error checking block status:", error);
    throw new HttpsError("internal", "Failed to check block status");
  }
});

// Helper functions to clean up data between blocked users

async function deleteActivityBetweenUsers(userId1: string, userId2: string): Promise<void> {
  // Delete activities where either user is the sender
  const activitiesRef = db.collection("users").doc(userId1).collection("activity");
  const query1 = activitiesRef.where("fromUserId", "==", userId2);
  const snapshot1 = await query1.get();
  
  const batch1 = db.batch();
  snapshot1.docs.forEach(doc => batch1.delete(doc.ref));
  await batch1.commit();

  // Delete activities in the other direction
  const activitiesRef2 = db.collection("users").doc(userId2).collection("activity");
  const query2 = activitiesRef2.where("fromUserId", "==", userId1);
  const snapshot2 = await query2.get();
  
  const batch2 = db.batch();
  snapshot2.docs.forEach(doc => batch2.delete(doc.ref));
  await batch2.commit();

  logger.info(`Deleted activity records between ${userId1} and ${userId2}`);
}

async function deleteFavoritesBetweenUsers(userId1: string, userId2: string): Promise<void> {
  const batch = db.batch();

  // Delete user1's favorite of user2
  const fav1Ref = db.collection("users").doc(userId1).collection("favorites").doc(userId2);
  batch.delete(fav1Ref);

  // Delete user2's favorite of user1
  const fav2Ref = db.collection("users").doc(userId2).collection("favorites").doc(userId1);
  batch.delete(fav2Ref);

  await batch.commit();
  logger.info(`Deleted favorites between ${userId1} and ${userId2}`);
}

async function deleteMatchesBetweenUsers(userId1: string, userId2: string): Promise<void> {
  // Matches are stored with both user IDs, find and delete
  const matchesQuery = db.collection("matches")
    .where("users", "array-contains", userId1);
  
  const snapshot = await matchesQuery.get();
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    const users = doc.data().users as string[];
    if (users.includes(userId2)) {
      batch.delete(doc.ref);
    }
  });
  
  await batch.commit();
  logger.info(`Deleted matches between ${userId1} and ${userId2}`);
}

async function deleteProfileViewsBetweenUsers(userId1: string, userId2: string): Promise<void> {
  const batch = db.batch();

  // Delete views where user1 viewed user2
  const views1Query = db.collection("profileViews")
    .where("viewerId", "==", userId1)
    .where("viewedUserId", "==", userId2);
  const snapshot1 = await views1Query.get();
  snapshot1.docs.forEach(doc => batch.delete(doc.ref));

  // Delete views where user2 viewed user1
  const views2Query = db.collection("profileViews")
    .where("viewerId", "==", userId2)
    .where("viewedUserId", "==", userId1);
  const snapshot2 = await views2Query.get();
  snapshot2.docs.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
  logger.info(`Deleted profile views between ${userId1} and ${userId2}`);
}

async function deletePhotoAccessBetweenUsers(userId1: string, userId2: string): Promise<void> {
  const batch = db.batch();

  // Delete photo access requests/grants in both directions
  const access1Ref = db.collection("users").doc(userId1).collection("photoAccessReceived").doc(userId2);
  const access2Ref = db.collection("users").doc(userId2).collection("photoAccessReceived").doc(userId1);
  const request1Ref = db.collection("users").doc(userId1).collection("photoAccessRequests").doc(userId2);
  const request2Ref = db.collection("users").doc(userId2).collection("photoAccessRequests").doc(userId1);

  batch.delete(access1Ref);
  batch.delete(access2Ref);
  batch.delete(request1Ref);
  batch.delete(request2Ref);

  await batch.commit();
  logger.info(`Deleted photo access between ${userId1} and ${userId2}`);
}
