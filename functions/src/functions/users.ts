/**
 * User Cloud Functions
 * Handles user-related triggers for denormalized fields
 * 
 * Denormalized fields maintained by these triggers:
 * - sortableLastActive: null if user hides activity, otherwise lastActiveAt
 * - isSearchable: false if profile hidden, account disabled, or scheduled for deletion
 * - isVerified: true if identity verification completed
 * - geohash: encoded location for distance-based queries
 * 
 * Private data maintained:
 * - trustScore: calculated from trust tasks
 * - subscription: tier and status
 * - tasks: individual trust task completion status
 */
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { 
  TRUST_TASK_DEFINITIONS, 
  TrustData, 
  TrustTask, 
  TrustCategory,
  getPointsPerCategory,
} from "../types/trust.types";

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
 * Calculate complete trust data based on user profile
 * Returns TrustData with score, tasks, and category breakdowns
 */
function calculateTrustData(data: FirebaseFirestore.DocumentData, existingTasks?: Record<string, TrustTask>): TrustData {
  const now = Timestamp.now();
  const tasks: Record<string, TrustTask> = {};
  const categoryPoints = getPointsPerCategory();
  
  // Initialize category stats
  const categories: Record<TrustCategory, {
    maxPoints: number;
    earnedPoints: number;
    completedTasks: number;
    totalTasks: number;
  }> = {
    verification: { maxPoints: categoryPoints.verification, earnedPoints: 0, completedTasks: 0, totalTasks: 0 },
    photos: { maxPoints: categoryPoints.photos, earnedPoints: 0, completedTasks: 0, totalTasks: 0 },
    profile: { maxPoints: categoryPoints.profile, earnedPoints: 0, completedTasks: 0, totalTasks: 0 },
    activity: { maxPoints: categoryPoints.activity, earnedPoints: 0, completedTasks: 0, totalTasks: 0 },
  };

  let earnedPoints = 0;
  let maxScore = 0;

  // Evaluate each task
  for (const taskDef of TRUST_TASK_DEFINITIONS) {
    const completed = taskDef.check(data);
    const value = taskDef.getValue ? taskDef.getValue(data) : undefined;
    const existingTask = existingTasks?.[taskDef.id];
    
    // Determine completedAt timestamp
    let completedAt: Timestamp | null = null;
    if (completed) {
      if (existingTask?.completed && existingTask.completedAt) {
        // Keep existing timestamp if task was already completed
        completedAt = existingTask.completedAt;
      } else {
        // New completion - use current timestamp
        completedAt = now;
      }
    }

    // Build task object - only include value if defined (Firestore doesn't accept undefined)
    const taskData: TrustTask = {
      completed,
      completedAt,
    };
    if (value !== undefined) {
      taskData.value = value;
    }
    tasks[taskDef.id] = taskData;

    // Update category stats
    categories[taskDef.category].totalTasks++;
    if (completed) {
      earnedPoints += taskDef.points;
      categories[taskDef.category].earnedPoints += taskDef.points;
      categories[taskDef.category].completedTasks++;
    }
    maxScore += taskDef.points;
  }

  // Calculate percentage score (0-100)
  const score = maxScore > 0 ? Math.round((earnedPoints / maxScore) * 100) : 0;

  return {
    score,
    lastCalculatedAt: now,
    maxScore,
    earnedPoints,
    tasks,
    categories,
  };
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

  // Note: trustScore is stored ONLY in users/{uid}/private/data for security
  // It is not written to the public user document

  return { isSearchable, isVerified, sortableLastActive, geohash };
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

    const { isSearchable, isVerified, sortableLastActive, geohash } = calculateDenormalizedFields(data);
    const trustData = calculateTrustData(data);

    // Update public denormalized fields on user document
    await db.collection("users").doc(userId).update({
      isSearchable,
      isVerified,
      sortableLastActive,
      geohash,
    });

    // Store sensitive data in private subcollection (only user can read, only functions can write)
    await db.collection("users").doc(userId).collection("private").doc("data").set({
      // Trust data
      trustScore: trustData.score,
      trust: trustData,
      
      // Subscription data
      subscription: {
        tier: "free",
        status: "active",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      
      updatedAt: Timestamp.now(),
    });

    logger.info(`Set denormalized fields for new user ${userId}:`, { 
      isSearchable, 
      isVerified, 
      trustScore: trustData.score,
      earnedPoints: trustData.earnedPoints,
      maxScore: trustData.maxScore,
      geohash: geohash?.substring(0, 4),
    });
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

    // Update trust data in private subcollection
    const privateDocRef = db.collection("users").doc(userId).collection("private").doc("data");
    const privateDoc = await privateDocRef.get();
    const existingData = privateDoc.exists ? privateDoc.data() : null;
    const existingTrustScore = existingData?.trustScore ?? null;
    const existingTasks = existingData?.trust?.tasks as Record<string, TrustTask> | undefined;

    // Calculate new trust data, preserving completedAt timestamps for already-completed tasks
    const trustData = calculateTrustData(afterData, existingTasks);

    // Only update if score changed or this is a new document
    if (trustData.score !== existingTrustScore || !privateDoc.exists) {
      logger.info(`Updating trust data for user ${userId}: ${existingTrustScore} -> ${trustData.score}`, {
        earnedPoints: trustData.earnedPoints,
        maxScore: trustData.maxScore,
        completedTasks: Object.values(trustData.tasks).filter(t => t.completed).length,
      });
      
      await privateDocRef.set({
        trustScore: trustData.score,
        trust: trustData,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  }
);
