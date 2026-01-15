/**
 * User Cloud Functions
 * Handles user-related triggers for denormalized fields
 * 
 * Denormalized fields maintained by these triggers:
 * - sortableLastActive: null if user hides activity, otherwise lastActiveAt
 * - isSearchable: false if profile hidden, account disabled, or scheduled for deletion
 * - isVerified: true if identity verification completed
 * - geohash: encoded location for distance-based queries
 */
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

/**
 * Generate a geohash for a lat/lng coordinate
 */
function encodeGeohash(latitude: number, longitude: number, precision: number = 9): string {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latRange = { min: -90, max: 90 };
  let lngRange = { min: -180, max: 180 };
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngRange.min + lngRange.max) / 2;
      if (longitude >= mid) {
        ch |= 1 << (4 - bit);
        lngRange.min = mid;
      } else {
        lngRange.max = mid;
      }
    } else {
      const mid = (latRange.min + latRange.max) / 2;
      if (latitude >= mid) {
        ch |= 1 << (4 - bit);
        latRange.min = mid;
      } else {
        latRange.max = mid;
      }
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * Calculate trust score based on user profile data
 * Score breakdown (100 points max):
 * - Verification: 30 points (identity verified)
 * - Photos: 25 points (profile photo: 10, 3+ photos: 10, 5+ photos: 5)
 * - Profile Details: 25 points (tagline: 5, about: 5, occupation: 5, education: 5, lifestyle: 5)
 * - Activity: 20 points (active recently: 10, profile visible: 10)
 */
function calculateTrustScore(data: FirebaseFirestore.DocumentData): number {
  const onboarding = data.onboarding || {};
  const photos = onboarding.photos || [];
  const privacySettings = data.settings?.privacy || {};
  let earned = 0;

  // Verification (30 points)
  if (onboarding.verificationOptions?.includes("identity")) {
    earned += 30;
  }

  // Photos (25 points)
  if (data.photoURL) earned += 10;
  if (photos.length >= 3) earned += 10;
  if (photos.length >= 5) earned += 5;

  // Profile Details (25 points)
  if (onboarding.tagline && onboarding.tagline.length > 0) earned += 5;
  if (onboarding.idealRelationship && onboarding.idealRelationship.length > 50) earned += 5;
  if (onboarding.occupation) earned += 5;
  if (onboarding.education) earned += 5;
  if (onboarding.smoker && onboarding.drinker) earned += 5;

  // Activity (20 points)
  const lastActiveAt = data.lastActiveAt as Timestamp | undefined;
  if (lastActiveAt) {
    const lastActiveDate = lastActiveAt.toDate();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    if (lastActiveDate > threeDaysAgo) earned += 10;
  }
  if (privacySettings.profileVisible !== false) earned += 10;

  return earned;
}

/**
 * Calculate denormalized fields based on user data
 */
function calculateDenormalizedFields(data: FirebaseFirestore.DocumentData) {
  // Privacy settings
  const privacySettings = data.settings?.privacy || {};
  const showLastActive = privacySettings.showLastActive !== false;
  const profileVisible = privacySettings.profileVisible !== false;

  // Account settings
  const accountSettings = data.settings?.account || {};
  const isDisabled = accountSettings.disabled === true;
  const isScheduledForDeletion = accountSettings.scheduledForDeletion === true;

  // Searchability: profile is visible AND not disabled AND not scheduled for deletion
  const isSearchable = profileVisible && !isDisabled && !isScheduledForDeletion && data.onboardingCompleted === true;

  // Verification status
  const isVerified = data.onboarding?.verificationOptions?.includes("identity") || false;

  // Sortable last active - only set if user allows showing last active time
  const lastActiveAt = data.lastActiveAt as Timestamp | undefined;
  const sortableLastActive = showLastActive && lastActiveAt ? lastActiveAt : null;

  // Geohash for location-based queries
  const location = data.onboarding?.location;
  const geohash = location?.latitude && location?.longitude
    ? encodeGeohash(location.latitude, location.longitude, 9)
    : null;

  // Trust score (stored in private subcollection, but calculated here)
  const trustScore = calculateTrustScore(data);

  return { isSearchable, isVerified, sortableLastActive, geohash, trustScore };
}

/**
 * Trigger when a user document is created
 * Sets initial denormalized fields and creates private data document
 */
export const onUserCreated = onDocumentCreated(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const userId = event.params.userId;
    const data = event.data?.data();

    if (!data) {
      logger.warn(`No data for new user: ${userId}`);
      return;
    }

    const { isSearchable, isVerified, sortableLastActive, geohash, trustScore } = calculateDenormalizedFields(data);

    // Update public denormalized fields on user document
    await db.collection("users").doc(userId).update({
      isSearchable,
      isVerified,
      sortableLastActive,
      geohash,
    });

    // Store sensitive data in private subcollection (only user can read, only functions can write)
    await db.collection("users").doc(userId).collection("private").doc("data").set({
      trustScore,
      subscription: {
        tier: "free",
        status: "active",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      updatedAt: Timestamp.now(),
    });

    logger.info(`Set denormalized fields for new user ${userId}:`, { isSearchable, isVerified, trustScore, geohash: geohash?.substring(0, 4) });
  }
);

/**
 * Trigger when a user document is updated
 * Keeps denormalized fields in sync
 */
export const onUserUpdated = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const userId = event.params.userId;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      logger.warn(`Missing data for user update: ${userId}`);
      return;
    }

    // Calculate expected values
    const expected = calculateDenormalizedFields(afterData);

    // Get current values from public document
    const current = {
      isSearchable: afterData.isSearchable,
      isVerified: afterData.isVerified,
      sortableLastActive: afterData.sortableLastActive,
      geohash: afterData.geohash,
    };

    // Determine what needs to be updated on public document
    const publicUpdates: Record<string, unknown> = {};

    if (expected.isSearchable !== current.isSearchable) {
      publicUpdates.isSearchable = expected.isSearchable;
    }

    if (expected.isVerified !== current.isVerified) {
      publicUpdates.isVerified = expected.isVerified;
    }

    // Check sortableLastActive
    const currentSortableMillis = (current.sortableLastActive as Timestamp)?.toMillis?.() || null;
    const expectedSortableMillis = (expected.sortableLastActive as Timestamp)?.toMillis?.() || null;
    
    if (currentSortableMillis !== expectedSortableMillis) {
      publicUpdates.sortableLastActive = expected.sortableLastActive;
    }

    // Check geohash
    if (expected.geohash !== current.geohash) {
      publicUpdates.geohash = expected.geohash;
    }

    // Update public document if there are changes
    if (Object.keys(publicUpdates).length > 0) {
      logger.info(`Updating public denormalized fields for user ${userId}:`, publicUpdates);
      await db.collection("users").doc(userId).update(publicUpdates);
    }

    // Check trust score in private subcollection
    const privateDocRef = db.collection("users").doc(userId).collection("private").doc("data");
    const privateDoc = await privateDocRef.get();
    const currentTrustScore = privateDoc.exists ? privateDoc.data()?.trustScore : null;

    if (expected.trustScore !== currentTrustScore) {
      logger.info(`Updating trust score for user ${userId}: ${currentTrustScore} -> ${expected.trustScore}`);
      await privateDocRef.set({
        trustScore: expected.trustScore,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  }
);
