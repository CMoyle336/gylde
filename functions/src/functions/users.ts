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

  return { isSearchable, isVerified, sortableLastActive, geohash };
}

/**
 * Trigger when a user document is created
 * Sets initial denormalized fields
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

    const { isSearchable, isVerified, sortableLastActive, geohash } = calculateDenormalizedFields(data);

    await db.collection("users").doc(userId).update({
      isSearchable,
      isVerified,
      sortableLastActive,
      geohash,
    });

    logger.info(`Set denormalized fields for new user ${userId}:`, { isSearchable, isVerified, geohash: geohash?.substring(0, 4) });
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

    // Get current values
    const current = {
      isSearchable: afterData.isSearchable,
      isVerified: afterData.isVerified,
      sortableLastActive: afterData.sortableLastActive,
      geohash: afterData.geohash,
    };

    // Determine what needs to be updated
    const updates: Record<string, unknown> = {};

    if (expected.isSearchable !== current.isSearchable) {
      updates.isSearchable = expected.isSearchable;
    }

    if (expected.isVerified !== current.isVerified) {
      updates.isVerified = expected.isVerified;
    }

    // Check sortableLastActive
    const currentSortableMillis = (current.sortableLastActive as Timestamp)?.toMillis?.() || null;
    const expectedSortableMillis = (expected.sortableLastActive as Timestamp)?.toMillis?.() || null;
    
    if (currentSortableMillis !== expectedSortableMillis) {
      updates.sortableLastActive = expected.sortableLastActive;
    }

    // Check geohash
    if (expected.geohash !== current.geohash) {
      updates.geohash = expected.geohash;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      logger.info(`Updating denormalized fields for user ${userId}:`, updates);
      await db.collection("users").doc(userId).update(updates);
    }
  }
);
