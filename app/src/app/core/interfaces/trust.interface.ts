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
    name: 'PROGRESS_PAGE.TASKS.IDENTITY_VERIFIED.NAME',
    description: 'PROGRESS_PAGE.TASKS.IDENTITY_VERIFIED.DESCRIPTION',
    points: 20,
    icon: 'badge',
    action: 'PROGRESS_PAGE.ACTIONS.VERIFY_NOW',
    route: '/settings',
  },
  {
    id: 'email_confirmed',
    category: 'verification',
    name: 'PROGRESS_PAGE.TASKS.EMAIL_CONFIRMED.NAME',
    description: 'PROGRESS_PAGE.TASKS.EMAIL_CONFIRMED.DESCRIPTION',
    points: 5,
    icon: 'mail',
    action: 'PROGRESS_PAGE.ACTIONS.VERIFY_EMAIL',
    route: '/settings',
  },
  {
    id: 'phone_verified',
    category: 'verification',
    name: 'PROGRESS_PAGE.TASKS.PHONE_VERIFIED.NAME',
    description: 'PROGRESS_PAGE.TASKS.PHONE_VERIFIED.DESCRIPTION',
    points: 5,
    icon: 'phone',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_PHONE',
    route: '/settings',
  },

  // ===== PHOTOS (20 points) =====
  {
    id: 'profile_photo',
    category: 'photos',
    name: 'PROGRESS_PAGE.TASKS.PROFILE_PHOTO.NAME',
    description: 'PROGRESS_PAGE.TASKS.PROFILE_PHOTO.DESCRIPTION',
    points: 8,
    icon: 'account_circle',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_PHOTO',
    route: '/profile',
  },
  {
    id: 'multiple_photos',
    category: 'photos',
    name: 'PROGRESS_PAGE.TASKS.MULTIPLE_PHOTOS.NAME',
    description: 'PROGRESS_PAGE.TASKS.MULTIPLE_PHOTOS.DESCRIPTION',
    points: 7,
    icon: 'collections',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_PHOTOS',
    route: '/profile',
  },
  {
    id: 'complete_gallery',
    category: 'photos',
    name: 'PROGRESS_PAGE.TASKS.COMPLETE_GALLERY.NAME',
    description: 'PROGRESS_PAGE.TASKS.COMPLETE_GALLERY.DESCRIPTION',
    points: 5,
    icon: 'grid_view',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_PHOTOS',
    route: '/profile',
  },

  // ===== PROFILE (25 points) =====
  {
    id: 'tagline_added',
    category: 'profile',
    name: 'PROGRESS_PAGE.TASKS.TAGLINE_ADDED.NAME',
    description: 'PROGRESS_PAGE.TASKS.TAGLINE_ADDED.DESCRIPTION',
    points: 5,
    icon: 'short_text',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_TAGLINE',
    route: '/profile',
  },
  {
    id: 'dating_preferences',
    category: 'profile',
    name: 'PROGRESS_PAGE.TASKS.DATING_PREFERENCES.NAME',
    description: 'PROGRESS_PAGE.TASKS.DATING_PREFERENCES.DESCRIPTION',
    points: 5,
    icon: 'tune',
    action: 'PROGRESS_PAGE.ACTIONS.EDIT_PREFERENCES',
    route: '/profile',
  },
  {
    id: 'about_written',
    category: 'profile',
    name: 'PROGRESS_PAGE.TASKS.ABOUT_WRITTEN.NAME',
    description: 'PROGRESS_PAGE.TASKS.ABOUT_WRITTEN.DESCRIPTION',
    points: 5,
    icon: 'edit_note',
    action: 'PROGRESS_PAGE.ACTIONS.EDIT_PROFILE',
    route: '/profile',
  },
  {
    id: 'personal_details',
    category: 'profile',
    name: 'PROGRESS_PAGE.TASKS.PERSONAL_DETAILS.NAME',
    description: 'PROGRESS_PAGE.TASKS.PERSONAL_DETAILS.DESCRIPTION',
    points: 5,
    icon: 'person',
    action: 'PROGRESS_PAGE.ACTIONS.ADD_DETAILS',
    route: '/profile',
  },
  {
    id: 'connection_types',
    category: 'profile',
    name: 'PROGRESS_PAGE.TASKS.CONNECTION_TYPES.NAME',
    description: 'PROGRESS_PAGE.TASKS.CONNECTION_TYPES.DESCRIPTION',
    points: 5,
    icon: 'handshake',
    action: 'PROGRESS_PAGE.ACTIONS.EDIT_PROFILE',
    route: '/profile',
  },

  // ===== ACTIVITY (25 points) =====
  {
    id: 'recently_active',
    category: 'activity',
    name: 'PROGRESS_PAGE.TASKS.RECENTLY_ACTIVE.NAME',
    description: 'PROGRESS_PAGE.TASKS.RECENTLY_ACTIVE.DESCRIPTION',
    points: 8,
    icon: 'schedule',
  },
  {
    id: 'has_favorites',
    category: 'activity',
    name: 'PROGRESS_PAGE.TASKS.HAS_FAVORITES.NAME',
    description: 'PROGRESS_PAGE.TASKS.HAS_FAVORITES.DESCRIPTION',
    points: 7,
    icon: 'favorite',
    action: 'PROGRESS_PAGE.ACTIONS.DISCOVER',
    route: '/discover',
  },
  {
    id: 'recent_conversations',
    category: 'activity',
    name: 'PROGRESS_PAGE.TASKS.RECENT_CONVERSATIONS.NAME',
    description: 'PROGRESS_PAGE.TASKS.RECENT_CONVERSATIONS.DESCRIPTION',
    points: 5,
    icon: 'chat',
    action: 'PROGRESS_PAGE.ACTIONS.MESSAGES',
    route: '/messages',
  },
  {
    id: 'profile_visible',
    category: 'activity',
    name: 'PROGRESS_PAGE.TASKS.PROFILE_VISIBLE.NAME',
    description: 'PROGRESS_PAGE.TASKS.PROFILE_VISIBLE.DESCRIPTION',
    points: 5,
    icon: 'visibility',
    action: 'PROGRESS_PAGE.ACTIONS.SETTINGS',
    route: '/settings',
  },
];

/**
 * Category definitions for UI display
 */
export const TRUST_CATEGORIES: TrustCategoryDefinition[] = [
  {
    id: 'verification',
    name: 'PROGRESS_PAGE.CATEGORIES.VERIFICATION.NAME',
    icon: 'verified_user',
    description: 'PROGRESS_PAGE.CATEGORIES.VERIFICATION.DESCRIPTION',
  },
  {
    id: 'photos',
    name: 'PROGRESS_PAGE.CATEGORIES.PHOTOS.NAME',
    icon: 'photo_library',
    description: 'PROGRESS_PAGE.CATEGORIES.PHOTOS.DESCRIPTION',
  },
  {
    id: 'profile',
    name: 'PROGRESS_PAGE.CATEGORIES.PROFILE.NAME',
    icon: 'person',
    description: 'PROGRESS_PAGE.CATEGORIES.PROFILE.DESCRIPTION',
  },
  {
    id: 'activity',
    name: 'PROGRESS_PAGE.CATEGORIES.ACTIVITY.NAME',
    icon: 'trending_up',
    description: 'PROGRESS_PAGE.CATEGORIES.ACTIVITY.DESCRIPTION',
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
