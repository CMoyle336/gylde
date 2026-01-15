/**
 * User profile interfaces
 */

import { GeoLocation } from './geo.interface';
import { Photo } from './photo.interface';

/**
 * Main user profile document structure
 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  lastActiveAt?: unknown; // Timestamp of last user activity
  
  // Denormalized fields for efficient Firestore queries
  // These are maintained by Cloud Function triggers
  sortableLastActive?: unknown | null; // null if user hides activity, otherwise same as lastActiveAt
  isSearchable?: boolean; // true if profile is visible and account is active
  isVerified?: boolean; // true if identity verification completed
  geohash?: string | null; // encoded location for distance-based queries
  trustScore?: number; // 0-100 trust score calculated by Cloud Functions
  
  onboardingCompleted: boolean;

  // Onboarding data (populated after onboarding)
  onboarding?: OnboardingProfile;

  // User settings (populated via settings page)
  settings?: UserSettings;
}

/**
 * User settings for privacy, notifications, and preferences
 */
export interface UserSettings {
  // Activity settings - what creates activity for others
  activity?: {
    createOnView?: boolean; // Create activity when you view someone's profile
    createOnFavorite?: boolean; // Create activity when you favorite someone
    createOnMessage?: boolean; // Create activity when you message someone
  };

  // Privacy settings
  privacy?: {
    showOnlineStatus?: boolean; // Show online/last active status to others
    showLastActive?: boolean; // Show last active timestamp
    profileVisible?: boolean; // Make profile visible in discovery
    showLocation?: boolean; // Show location on profile
  };

  // Notification settings
  notifications?: {
    emailMatches?: boolean; // Email when you get a match
    emailMessages?: boolean; // Email when you get a message
    emailFavorites?: boolean; // Email when someone favorites you
    pushEnabled?: boolean; // Enable push notifications
  };

  // Preferences
  preferences?: {
    language?: string; // Preferred language code
    theme?: 'light' | 'dark' | 'system'; // App theme
  };

  // Account status
  account?: {
    disabled?: boolean; // Account is temporarily disabled
    disabledAt?: unknown; // When account was disabled
    scheduledForDeletion?: boolean; // Account scheduled for deletion
    deletionScheduledAt?: unknown; // When deletion was scheduled
  };
}

/**
 * Minimal user info for display purposes
 */
export interface UserDisplayInfo {
  displayName?: string;
  photoURL?: string;
  email?: string;
}

/**
 * User's onboarding profile data
 * Collected during the onboarding flow
 */
export interface OnboardingProfile {
  // Step 1: Eligibility
  birthDate: string; // ISO date string (YYYY-MM-DD)
  city: string;
  country: string;
  location?: GeoLocation;

  // Step 2: Dating Identity
  genderIdentity: string;
  genderCustom?: string;
  interestedIn: string[];
  ageRangeMin: number;
  ageRangeMax: number;

  // Step 3: Relationship Intent
  connectionTypes: string[];

  // Step 4: Support Orientation
  supportOrientation: string;

  // Tagline - short phrase displayed on profile card and profile page
  tagline?: string;

  // Step 5: Open-Ended Prompts
  idealRelationship: string;
  supportMeaning?: string;

  // Step 6: Photos
  photos: string[]; // Legacy: array of URLs for backward compatibility
  photoDetails?: Photo[]; // New: detailed photo objects with privacy info

  // Step 7: Verification
  verificationOptions: string[];

  // Optional secondary profile info (added via profile page)
  height?: string; // e.g., "5'10" or "178 cm"
  weight?: string; // e.g., "170 lbs" or "77 kg"
  ethnicity?: string;
  relationshipStatus?: string;
  children?: string;
  smoker?: string;
  drinker?: string;
  education?: string;
  occupation?: string;
  income?: string; // e.g., "$100,000 - $150,000"
}
