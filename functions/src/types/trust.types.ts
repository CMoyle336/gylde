/**
 * Trust Score Types
 *
 * The trust system is designed to be flexible and extensible.
 * Tasks can be added/removed/reweighted without major refactoring.
 */

import {Timestamp} from "firebase-admin/firestore";

/**
 * Individual trust task completion status
 */
export interface TrustTask {
  completed: boolean;
  completedAt: Timestamp | null;
  value?: number | string; // Optional: store the actual value (e.g., photo count, last active date)
}

/**
 * Trust task definition (used for calculation)
 */
export interface TrustTaskDefinition {
  id: string;
  category: TrustCategory;
  name: string;
  description: string;
  points: number;
  // Function to check if task is completed based on user data
  check: (data: FirebaseFirestore.DocumentData) => boolean;
  // Optional: extract the current value for display
  getValue?: (data: FirebaseFirestore.DocumentData) => number | string | undefined;
}

/**
 * Trust categories
 */
export type TrustCategory =
  | "verification"
  | "photos"
  | "profile"
  | "activity";

/**
 * Complete trust data stored in users/{uid}/private/data
 */
export interface TrustData {
  // Overall calculated score (0-100)
  score: number;

  // When the score was last calculated
  lastCalculatedAt: Timestamp;

  // Maximum possible score (sum of all task points)
  maxScore: number;

  // Points earned
  earnedPoints: number;

  // Individual task statuses
  tasks: Record<string, TrustTask>;

  // Category breakdowns
  categories: Record<TrustCategory, {
    maxPoints: number;
    earnedPoints: number;
    completedTasks: number;
    totalTasks: number;
  }>;
}

/**
 * Trust task definitions with weights
 *
 * Point allocation (100 total):
 * - Verification: 30 points (identity is the big one)
 * - Photos: 20 points
 * - Profile: 25 points
 * - Activity: 25 points
 */
export const TRUST_TASK_DEFINITIONS: TrustTaskDefinition[] = [
  // ===== VERIFICATION (30 points) =====
  {
    id: "identity_verified",
    category: "verification",
    name: "Verify Identity",
    description: "Complete identity verification to prove you are who you say you are",
    points: 20,
    check: (data) => data.identityVerified === true,
  },
  {
    id: "email_confirmed",
    category: "verification",
    name: "Confirm Email",
    description: "Verify your email address",
    points: 5,
    check: (data) => data.emailVerified === true,
  },
  {
    id: "phone_verified",
    category: "verification",
    name: "Verify Phone",
    description: "Add and verify your phone number",
    points: 5,
    check: (data) => data.phoneNumberVerified === true,
  },

  // ===== PHOTOS (20 points) =====
  {
    id: "profile_photo",
    category: "photos",
    name: "Add Profile Photo",
    description: "Upload your main profile photo",
    points: 8,
    check: (data) => !!data.photoURL,
  },
  {
    id: "multiple_photos",
    category: "photos",
    name: "Add Multiple Photos",
    description: "Upload at least 3 photos to your profile",
    points: 7,
    check: (data) => (data.onboarding?.photoDetails?.length || 0) >= 3,
    getValue: (data) => data.onboarding?.photoDetails?.length || 0,
  },
  {
    id: "complete_gallery",
    category: "photos",
    name: "Complete Photo Gallery",
    description: "Upload 5 or more photos for a complete profile",
    points: 5,
    check: (data) => (data.onboarding?.photoDetails?.length || 0) >= 5,
    getValue: (data) => data.onboarding?.photoDetails?.length || 0,
  },

  // ===== PROFILE (25 points) =====
  {
    id: "tagline_added",
    category: "profile",
    name: "Add Tagline",
    description: "Write a short tagline that describes you",
    points: 5,
    check: (data) => (data.onboarding?.tagline?.length || 0) > 0,
  },
  {
    id: "dating_preferences",
    category: "profile",
    name: "Set Dating Preferences",
    description: "Specify who you're interested in meeting",
    points: 5,
    check: (data) => {
      const onboarding = data.onboarding;
      return (
        onboarding?.interestedIn?.length > 0 &&
        onboarding?.ageRangeMin !== undefined &&
        onboarding?.ageRangeMax !== undefined
      );
    },
  },
  {
    id: "about_written",
    category: "profile",
    name: "Write About Yourself",
    description: "Share what you're looking for (at least 50 characters)",
    points: 5,
    check: (data) => (data.onboarding?.idealRelationship?.length || 0) >= 50,
    getValue: (data) => data.onboarding?.idealRelationship?.length || 0,
  },
  {
    id: "personal_details",
    category: "profile",
    name: "Complete Personal Details",
    description: "Fill in at least 3 personal details (height, ethnicity, lifestyle, etc.)",
    points: 5,
    check: (data) => {
      const onboarding = data.onboarding || {};
      // At least 3 of these fields should be filled
      const fields = [
        onboarding.height,
        onboarding.weight,
        onboarding.ethnicity,
        onboarding.relationshipStatus,
        onboarding.children,
        onboarding.smoker,
        onboarding.drinker,
        onboarding.education,
        onboarding.occupation,
        onboarding.income,
      ];
      const filledCount = fields.filter((v) => v && v !== "").length;
      return filledCount >= 3;
    },
    getValue: (data) => {
      const onboarding = data.onboarding || {};
      const fields = [
        onboarding.height,
        onboarding.weight,
        onboarding.ethnicity,
        onboarding.relationshipStatus,
        onboarding.children,
        onboarding.smoker,
        onboarding.drinker,
        onboarding.education,
        onboarding.occupation,
        onboarding.income,
      ];
      return fields.filter((v) => v && v !== "").length;
    },
  },
  {
    id: "connection_types",
    category: "profile",
    name: "Define Connection Types",
    description: "Specify what types of connections you're seeking",
    points: 5,
    check: (data) => (data.onboarding?.connectionTypes?.length || 0) > 0,
  },

  // ===== ACTIVITY (25 points) =====
  {
    id: "recently_active",
    category: "activity",
    name: "Stay Active",
    description: "Log in within the last 3 days",
    points: 8,
    check: (data) => {
      const lastActiveAt = data.lastActiveAt as Timestamp | undefined;
      if (!lastActiveAt) return false;
      const lastActiveDate = lastActiveAt.toDate();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      return lastActiveDate > threeDaysAgo;
    },
    getValue: (data) => {
      const lastActiveAt = data.lastActiveAt as Timestamp | undefined;
      return lastActiveAt?.toDate()?.toISOString();
    },
  },
  {
    id: "has_favorites",
    category: "activity",
    name: "Engage with Profiles",
    description: "Favorite at least 3 profiles",
    points: 7,
    check: (data) => (data.favoritesCount || 0) >= 3,
    getValue: (data) => data.favoritesCount || 0,
  },
  {
    id: "recent_conversations",
    category: "activity",
    name: "Start Conversations",
    description: "Send a message within the last 7 days",
    points: 5,
    check: (data) => {
      const lastMessageSentAt = data.lastMessageSentAt as Timestamp | undefined;
      if (!lastMessageSentAt) return false;
      const lastMessageDate = lastMessageSentAt.toDate();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return lastMessageDate > sevenDaysAgo;
    },
    getValue: (data) => {
      const lastMessageSentAt = data.lastMessageSentAt as Timestamp | undefined;
      return lastMessageSentAt?.toDate()?.toISOString();
    },
  },
  {
    id: "profile_visible",
    category: "activity",
    name: "Profile Visible",
    description: "Keep your profile visible to be discovered",
    points: 5,
    check: (data) => data.settings?.privacy?.profileVisible !== false,
  },
];

/**
 * Get all task definitions grouped by category
 */
export function getTasksByCategory(): Record<TrustCategory, TrustTaskDefinition[]> {
  const grouped: Record<TrustCategory, TrustTaskDefinition[]> = {
    verification: [],
    photos: [],
    profile: [],
    activity: [],
  };

  for (const task of TRUST_TASK_DEFINITIONS) {
    grouped[task.category].push(task);
  }

  return grouped;
}

/**
 * Calculate total possible points
 */
export function getMaxPossibleScore(): number {
  return TRUST_TASK_DEFINITIONS.reduce((sum, task) => sum + task.points, 0);
}

/**
 * Calculate points per category
 */
export function getPointsPerCategory(): Record<TrustCategory, number> {
  const points: Record<TrustCategory, number> = {
    verification: 0,
    photos: 0,
    profile: 0,
    activity: 0,
  };

  for (const task of TRUST_TASK_DEFINITIONS) {
    points[task.category] += task.points;
  }

  return points;
}
