/**
 * Trust Score Interfaces
 * 
 * The trust system tracks user profile completeness and activity
 * to calculate a trust score (0-100).
 * 
 * NOTE: Trust data is stored in users/{uid}/private/data and can only
 * be read by the owning user and written by Cloud Functions.
 */

/**
 * Individual trust task status
 */
export interface TrustTask {
  completed: boolean;
  completedAt: unknown | null; // Firestore Timestamp
  value?: number | string; // Optional: the actual value (e.g., photo count)
}

/**
 * Trust category types
 */
export type TrustCategory = 
  | 'verification'
  | 'photos' 
  | 'profile'
  | 'activity';

/**
 * Category breakdown
 */
export interface TrustCategoryStats {
  maxPoints: number;
  earnedPoints: number;
  completedTasks: number;
  totalTasks: number;
}

/**
 * Complete trust data (stored in private subcollection)
 */
export interface TrustData {
  // Overall calculated score (0-100)
  score: number;
  
  // When the score was last calculated
  lastCalculatedAt: unknown; // Firestore Timestamp
  
  // Maximum possible score (sum of all task points)
  maxScore: number;
  
  // Points earned
  earnedPoints: number;
  
  // Individual task statuses (keyed by task ID)
  tasks: Record<string, TrustTask>;
  
  // Category breakdowns
  categories: Record<TrustCategory, TrustCategoryStats>;
}

/**
 * Task definition for UI display
 */
export interface TrustTaskDefinition {
  id: string;
  category: TrustCategory;
  name: string;
  description: string;
  points: number;
  icon: string;
  action?: string;
  route?: string;
}

/**
 * Category definition for UI display
 */
export interface TrustCategoryDefinition {
  id: TrustCategory;
  name: string;
  icon: string;
  description: string;
}

/**
 * Task definitions for UI display
 * Points should match the server-side definitions
 */
export const TRUST_TASK_UI: TrustTaskDefinition[] = [
  // ===== VERIFICATION (30 points) =====
  {
    id: 'identity_verified',
    category: 'verification',
    name: 'Verify Identity',
    description: 'Complete identity verification to prove you are who you say you are',
    points: 20,
    icon: 'badge',
    action: 'Verify Now',
    route: '/settings',
  },
  {
    id: 'email_confirmed',
    category: 'verification',
    name: 'Confirm Email',
    description: 'Verify your email address',
    points: 5,
    icon: 'mail',
    action: 'Verify Email',
    route: '/settings',
  },
  {
    id: 'phone_verified',
    category: 'verification',
    name: 'Verify Phone',
    description: 'Add and verify your phone number',
    points: 5,
    icon: 'phone',
    action: 'Add Phone',
    route: '/settings',
  },

  // ===== PHOTOS (20 points) =====
  {
    id: 'profile_photo',
    category: 'photos',
    name: 'Add Profile Photo',
    description: 'Upload your main profile photo',
    points: 8,
    icon: 'account_circle',
    action: 'Add Photo',
    route: '/profile',
  },
  {
    id: 'multiple_photos',
    category: 'photos',
    name: 'Add Multiple Photos',
    description: 'Upload at least 3 photos to your profile',
    points: 7,
    icon: 'collections',
    action: 'Add Photos',
    route: '/profile',
  },
  {
    id: 'complete_gallery',
    category: 'photos',
    name: 'Complete Photo Gallery',
    description: 'Upload 5 or more photos for a complete profile',
    points: 5,
    icon: 'grid_view',
    action: 'Add Photos',
    route: '/profile',
  },

  // ===== PROFILE (25 points) =====
  {
    id: 'tagline_added',
    category: 'profile',
    name: 'Add Tagline',
    description: 'Write a short tagline that describes you',
    points: 5,
    icon: 'short_text',
    action: 'Add Tagline',
    route: '/profile',
  },
  {
    id: 'dating_preferences',
    category: 'profile',
    name: 'Set Dating Preferences',
    description: 'Specify who you\'re interested in meeting',
    points: 5,
    icon: 'tune',
    action: 'Edit Preferences',
    route: '/profile',
  },
  {
    id: 'about_written',
    category: 'profile',
    name: 'Write About Yourself',
    description: 'Share what you\'re looking for (at least 50 characters)',
    points: 5,
    icon: 'edit_note',
    action: 'Edit Profile',
    route: '/profile',
  },
  {
    id: 'personal_details',
    category: 'profile',
    name: 'Complete Personal Details',
    description: 'Fill in at least 3 details (occupation, education, etc.)',
    points: 5,
    icon: 'person',
    action: 'Add Details',
    route: '/profile',
  },
  {
    id: 'connection_types',
    category: 'profile',
    name: 'Define Connection Types',
    description: 'Specify what types of connections you\'re seeking',
    points: 5,
    icon: 'handshake',
    action: 'Edit Profile',
    route: '/profile',
  },

  // ===== ACTIVITY (25 points) =====
  {
    id: 'recently_active',
    category: 'activity',
    name: 'Stay Active',
    description: 'Log in within the last 3 days',
    points: 8,
    icon: 'schedule',
  },
  {
    id: 'has_favorites',
    category: 'activity',
    name: 'Engage with Profiles',
    description: 'Favorite at least 3 profiles',
    points: 7,
    icon: 'favorite',
    action: 'Discover',
    route: '/discover',
  },
  {
    id: 'recent_conversations',
    category: 'activity',
    name: 'Start Conversations',
    description: 'Have at least one conversation with recent activity',
    points: 5,
    icon: 'chat',
    action: 'Messages',
    route: '/messages',
  },
  {
    id: 'profile_visible',
    category: 'activity',
    name: 'Profile Visible',
    description: 'Keep your profile visible to be discovered',
    points: 5,
    icon: 'visibility',
    action: 'Settings',
    route: '/settings',
  },
];

/**
 * Category definitions for UI display
 */
export const TRUST_CATEGORIES: TrustCategoryDefinition[] = [
  {
    id: 'verification',
    name: 'Verification',
    icon: 'verified_user',
    description: 'Verify your identity to build trust',
  },
  {
    id: 'photos',
    name: 'Photos',
    icon: 'photo_library',
    description: 'Add photos to your profile',
  },
  {
    id: 'profile',
    name: 'Profile',
    icon: 'person',
    description: 'Complete your profile information',
  },
  {
    id: 'activity',
    name: 'Activity',
    icon: 'trending_up',
    description: 'Stay active on the platform',
  },
];

/**
 * Get task definitions grouped by category
 */
export function getTasksByCategory(): Record<TrustCategory, TrustTaskDefinition[]> {
  const grouped: Record<TrustCategory, TrustTaskDefinition[]> = {
    verification: [],
    photos: [],
    profile: [],
    activity: [],
  };

  for (const task of TRUST_TASK_UI) {
    grouped[task.category].push(task);
  }

  return grouped;
}

/**
 * Get max points per category
 */
export function getPointsPerCategory(): Record<TrustCategory, number> {
  const points: Record<TrustCategory, number> = {
    verification: 0,
    photos: 0,
    profile: 0,
    activity: 0,
  };

  for (const task of TRUST_TASK_UI) {
    points[task.category] += task.points;
  }

  return points;
}
