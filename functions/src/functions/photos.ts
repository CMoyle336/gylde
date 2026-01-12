/**
 * Cloud Functions for private photo access management
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { PhotoAccessRequest, PhotoAccessGrant } from "../types";

const db = getFirestore();

/**
 * Request access to view a user's private photos
 */
export const requestPhotoAccess = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { targetUserId } = data;
  const requesterId = auth.uid;

  if (!targetUserId || typeof targetUserId !== "string") {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  if (requesterId === targetUserId) {
    throw new HttpsError("invalid-argument", "Cannot request access to your own photos");
  }

  // Get requester's profile info
  const requesterDoc = await db.collection("users").doc(requesterId).get();
  if (!requesterDoc.exists) {
    throw new HttpsError("not-found", "Your profile was not found");
  }

  const requesterData = requesterDoc.data();
  const requesterName = requesterData?.displayName || "Unknown User";
  const requesterPhoto = requesterData?.photoURL || null;

  // Check if request already exists
  const existingRequest = await db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessRequests")
    .doc(requesterId)
    .get();

  if (existingRequest.exists) {
    const status = existingRequest.data()?.status;
    if (status === "pending") {
      throw new HttpsError("already-exists", "Request already pending");
    }
    if (status === "granted") {
      throw new HttpsError("already-exists", "Access already granted");
    }
  }

  // Check if user already has a grant (in case request was deleted but grant exists)
  const existingGrant = await db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessGrants")
    .doc(requesterId)
    .get();

  if (existingGrant.exists) {
    throw new HttpsError("already-exists", "Access already granted");
  }

  // Create the access request
  const accessRequest: PhotoAccessRequest = {
    requesterId,
    requesterName,
    requesterPhoto,
    requestedAt: Timestamp.now(),
    status: "pending",
  };

  await db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessRequests")
    .doc(requesterId)
    .set(accessRequest);

  // Update request count on target user's profile
  await db.collection("users").doc(targetUserId).update({
    pendingPhotoAccessCount: FieldValue.increment(1),
  });

  // Activity creation is handled by onPhotoAccessRequestWrite trigger

  return { success: true, message: "Request sent" };
});

/**
 * Cancel a pending photo access request
 */
export const cancelPhotoAccessRequest = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { targetUserId } = data;
  const requesterId = auth.uid;

  if (!targetUserId || typeof targetUserId !== "string") {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  // Check if request exists
  const requestRef = db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessRequests")
    .doc(requesterId);

  const requestDoc = await requestRef.get();

  if (!requestDoc.exists) {
    throw new HttpsError("not-found", "No pending request found");
  }

  const requestData = requestDoc.data();
  if (requestData?.status !== "pending") {
    throw new HttpsError(
      "failed-precondition",
      "Can only cancel pending requests"
    );
  }

  // Delete the request (activity deletion is handled by onPhotoAccessRequestDeleted trigger)
  await requestRef.delete();

  // Decrement pending count on target user
  await db.collection("users").doc(targetUserId).update({
    pendingPhotoAccessCount: FieldValue.increment(-1),
  });

  return { success: true, message: "Request cancelled" };
});

/**
 * Respond to a photo access request (grant or deny)
 */
export const respondToPhotoAccessRequest = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { requesterId, response } = data;
  const ownerId = auth.uid;

  if (!requesterId || typeof requesterId !== "string") {
    throw new HttpsError("invalid-argument", "Requester ID is required");
  }

  if (response !== "grant" && response !== "deny") {
    throw new HttpsError("invalid-argument", "Response must be 'grant' or 'deny'");
  }

  // Get the request
  const requestRef = db
    .collection("users")
    .doc(ownerId)
    .collection("photoAccessRequests")
    .doc(requesterId);

  const requestDoc = await requestRef.get();

  if (!requestDoc.exists) {
    throw new HttpsError("not-found", "Request not found");
  }

  const requestData = requestDoc.data() as PhotoAccessRequest;

  if (requestData.status !== "pending") {
    throw new HttpsError("failed-precondition", "Request has already been responded to");
  }

  const batch = db.batch();

  // Update the request status
  batch.update(requestRef, {
    status: response === "grant" ? "granted" : "denied",
    respondedAt: Timestamp.now(),
  });

  // Decrement pending count
  batch.update(db.collection("users").doc(ownerId), {
    pendingPhotoAccessCount: FieldValue.increment(-1),
  });

  if (response === "grant") {
    // Create a grant document
    const grant: PhotoAccessGrant = {
      grantedToUserId: requesterId,
      grantedToName: requestData.requesterName,
      grantedToPhoto: requestData.requesterPhoto,
      grantedAt: Timestamp.now(),
    };

    batch.set(
      db.collection("users").doc(ownerId).collection("photoAccessGrants").doc(requesterId),
      grant
    );

    // Also create a reverse reference so the requester knows they have access
    // Stored in: users/{requesterId}/photoAccessReceived/{ownerId}
    const ownerDoc = await db.collection("users").doc(ownerId).get();
    const ownerData = ownerDoc.data();

    batch.set(
      db.collection("users").doc(requesterId).collection("photoAccessReceived").doc(ownerId),
      {
        ownerId: ownerId,
        ownerName: ownerData?.displayName || "Unknown",
        ownerPhoto: ownerData?.photoURL || null,
        grantedAt: Timestamp.now(),
      }
    );
  }

  await batch.commit();

  return {
    success: true,
    message: response === "grant" ? "Access granted" : "Request denied",
  };
});

/**
 * Revoke previously granted photo access
 */
export const revokePhotoAccess = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { userId } = data;
  const ownerId = auth.uid;

  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "User ID is required");
  }

  // Check if grant exists
  const grantRef = db
    .collection("users")
    .doc(ownerId)
    .collection("photoAccessGrants")
    .doc(userId);

  const grantDoc = await grantRef.get();

  if (!grantDoc.exists) {
    throw new HttpsError("not-found", "Access grant not found");
  }

  const batch = db.batch();

  // Delete the grant
  batch.delete(grantRef);

  // Delete the reverse reference
  batch.delete(
    db.collection("users").doc(userId).collection("photoAccessReceived").doc(ownerId)
  );

  // Update the original request status back to denied (so they can request again)
  const requestRef = db
    .collection("users")
    .doc(ownerId)
    .collection("photoAccessRequests")
    .doc(userId);

  const requestDoc = await requestRef.get();
  if (requestDoc.exists) {
    batch.update(requestRef, {
      status: "denied",
      respondedAt: Timestamp.now(),
    });
  }

  await batch.commit();

  return { success: true, message: "Access revoked" };
});

/**
 * Check if current user has access to view another user's private photos
 */
export const checkPhotoAccess = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { targetUserId } = data;
  const requesterId = auth.uid;

  if (!targetUserId || typeof targetUserId !== "string") {
    throw new HttpsError("invalid-argument", "Target user ID is required");
  }

  // Self always has access
  if (requesterId === targetUserId) {
    return { hasAccess: true, isSelf: true };
  }

  // Check for existing grant
  const grantDoc = await db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessGrants")
    .doc(requesterId)
    .get();

  if (grantDoc.exists) {
    return { hasAccess: true, isSelf: false };
  }

  // Check for pending/denied request
  const requestDoc = await db
    .collection("users")
    .doc(targetUserId)
    .collection("photoAccessRequests")
    .doc(requesterId)
    .get();

  if (requestDoc.exists) {
    const status = requestDoc.data()?.status;
    return {
      hasAccess: false,
      isSelf: false,
      requestStatus: status,
      requestedAt: requestDoc.data()?.requestedAt?.toDate(),
    };
  }

  return { hasAccess: false, isSelf: false, requestStatus: null };
});

/**
 * Get list of users who have been granted access to view private photos
 */
export const getPhotoAccessGrants = onCall(async (request) => {
  const { auth } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const ownerId = auth.uid;

  const grantsSnapshot = await db
    .collection("users")
    .doc(ownerId)
    .collection("photoAccessGrants")
    .orderBy("grantedAt", "desc")
    .get();

  const grants = grantsSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    grantedAt: doc.data().grantedAt?.toDate(),
  }));

  return { grants };
});

/**
 * Get list of pending photo access requests
 */
export const getPhotoAccessRequests = onCall(async (request) => {
  const { auth } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const ownerId = auth.uid;

  const requestsSnapshot = await db
    .collection("users")
    .doc(ownerId)
    .collection("photoAccessRequests")
    .where("status", "==", "pending")
    .orderBy("requestedAt", "desc")
    .get();

  const requests = requestsSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    requestedAt: doc.data().requestedAt?.toDate(),
  }));

  return { requests };
});

/**
 * Toggle a photo's private status
 */
export const togglePhotoPrivacy = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  const { photoUrl, isPrivate } = data;
  const userId = auth.uid;

  if (!photoUrl || typeof photoUrl !== "string") {
    throw new HttpsError("invalid-argument", "Photo URL is required");
  }

  if (typeof isPrivate !== "boolean") {
    throw new HttpsError("invalid-argument", "isPrivate must be a boolean");
  }

  // Get user's profile
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User profile not found");
  }

  const userData = userDoc.data();
  const profilePhotoUrl = userData?.photoURL;

  // Cannot make profile photo private
  if (isPrivate && photoUrl === profilePhotoUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Profile photo cannot be made private. Change your profile photo first."
    );
  }

  // Get or initialize photoDetails
  const existingPhotoDetails = userData?.onboarding?.photoDetails || [];
  const photos = userData?.onboarding?.photos || [];

  // Find or create the photo detail
  let photoDetails = [...existingPhotoDetails];
  const existingIndex = photoDetails.findIndex((p: { url: string }) => p.url === photoUrl);

  if (existingIndex >= 0) {
    // Update existing
    photoDetails[existingIndex] = {
      ...photoDetails[existingIndex],
      isPrivate,
    };
  } else {
    // Create new photo detail entry
    const order = photos.indexOf(photoUrl);
    photoDetails.push({
      id: `photo_${Date.now()}`,
      url: photoUrl,
      isPrivate,
      uploadedAt: Timestamp.now(),
      order: order >= 0 ? order : photoDetails.length,
    });
  }

  // Update user document
  await db.collection("users").doc(userId).update({
    "onboarding.photoDetails": photoDetails,
  });

  return {
    success: true,
    message: isPrivate ? "Photo marked as private" : "Photo made public",
  };
});

// ============================================================
// FIRESTORE TRIGGERS FOR PHOTO ACCESS REQUESTS
// ============================================================

import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";

/**
 * Trigger: When a photo access request is created or updated
 * - For pending requests: creates activity for the target user (owner)
 * - For granted/denied: creates activity for the requester to notify them
 */
export const onPhotoAccessRequestWrite = onDocumentWritten(
  "users/{targetUserId}/photoAccessRequests/{requesterId}",
  async (event) => {
    const { targetUserId, requesterId } = event.params;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    // If document was deleted, skip (handled by onPhotoAccessRequestDeleted)
    if (!afterData) {
      return;
    }

    // Case 1: New pending request or updated pending request
    // Create/update activity for the target user (photo owner)
    if (afterData.status === "pending") {
      const activitiesRef = db
        .collection("users")
        .doc(targetUserId)
        .collection("activities");

      // Check for existing activity from this user
      const existingActivity = await activitiesRef
        .where("type", "==", "photo_access_request")
        .where("fromUserId", "==", requesterId)
        .limit(1)
        .get();

      if (!existingActivity.empty) {
        // Update existing activity
        await existingActivity.docs[0].ref.update({
          createdAt: Timestamp.now(),
          read: false,
          fromUserName: afterData.requesterName,
          fromUserPhoto: afterData.requesterPhoto,
          link: null,
        });
      } else {
        // Create new activity
        await activitiesRef.add({
          type: "photo_access_request",
          fromUserId: requesterId,
          fromUserName: afterData.requesterName,
          fromUserPhoto: afterData.requesterPhoto,
          toUserId: targetUserId,
          read: false,
          createdAt: Timestamp.now(),
          link: null,
        });
      }
      return;
    }

    // Case 2: Status changed from pending to granted or denied
    // Create activity for the requester to notify them
    const wasStatusChange =
      beforeData?.status === "pending" &&
      (afterData.status === "granted" || afterData.status === "denied");

    if (wasStatusChange) {
      // Get the target user's (owner's) profile info
      const ownerDoc = await db.collection("users").doc(targetUserId).get();
      const ownerData = ownerDoc.data();
      const ownerName = ownerData?.displayName || "Someone";
      const ownerPhoto = ownerData?.photoURL || null;

      const activityType = afterData.status === "granted"
        ? "photo_access_granted"
        : "photo_access_denied";

      // Create activity for the requester
      await db
        .collection("users")
        .doc(requesterId)
        .collection("activities")
        .add({
          type: activityType,
          fromUserId: targetUserId,
          fromUserName: ownerName,
          fromUserPhoto: ownerPhoto,
          toUserId: requesterId,
          read: false,
          createdAt: Timestamp.now(),
          link: `/user/${targetUserId}`,
        });
    }
  }
);

/**
 * Trigger: When a photo access request is deleted
 * Deletes the corresponding activity record
 */
export const onPhotoAccessRequestDeleted = onDocumentDeleted(
  "users/{targetUserId}/photoAccessRequests/{requesterId}",
  async (event) => {
    const { targetUserId, requesterId } = event.params;

    const activitiesRef = db
      .collection("users")
      .doc(targetUserId)
      .collection("activities");

    const activityQuery = await activitiesRef
      .where("type", "==", "photo_access_request")
      .where("fromUserId", "==", requesterId)
      .limit(1)
      .get();

    if (!activityQuery.empty) {
      await activityQuery.docs[0].ref.delete();
    }
  }
);
