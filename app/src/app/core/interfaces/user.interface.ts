/**
 * User profile interfaces
 */

import { GeoLocation } from './geo.interface';
import { Photo } from './photo.interface';
import { ReputationTier } from './reputation.interface';
import { UserSubscription } from './subscription.interface';

/**
 * Virtual phone number data (Elite feature)
 * Stored in users/{uid}/private/data for security
 */
export interface VirtualPhone {
  /** The Twilio phone number in E.164 format */
  number: string;
  /** Twilio Phone Number SID */
  twilioSid: string;
  /** User's verified phone number where calls/texts are forwarded */
  forwardingNumber: string;
  /** When the number was provisioned */
  provisionedAt: unknown;
  /** Current status of the virtual number */
  status?: 'active' | 'suspended' | 'released';
  /** Virtual phone settings */
  settings: VirtualPhoneSettings;
}

/**
 * Virtual phone settings
 */
export interface VirtualPhoneSettings {
  /** Do not disturb mode - silences calls/texts */
  doNotDisturb: boolean;
  /** Forward incoming calls to the app */
  forwardCalls: boolean;
  /** Forward incoming texts to the app */
  forwardTexts: boolean;
}

/**
 * Main user profile document structure
 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified?: boolean; // Whether email has been verified (synced from Firebase Auth)
  phoneNumber?: string | null; // User's verified phone number (E.164 format)
  phoneNumberVerified?: boolean; // Whether phone number has been verified
  createdAt: unknown;
  updatedAt: unknown;
  lastActiveAt?: unknown; // Timestamp of last user activity
  
  // Denormalized fields for efficient Firestore queries
  // These are maintained by Cloud Function triggers
  sortableLastActive?: unknown | null; // null if user hides activity, otherwise same as lastActiveAt
  isSearchable?: boolean; // true if profile is visible and account is active
  identityVerified?: boolean; // true if identity verification completed
  identityVerificationSessionId?: string; // Veriff session ID for tracking
  identityVerificationStatus?: 'pending' | 'approved' | 'declined' | 'cancelled'; // Verification status
  identityVerificationPaid?: boolean; // true if user has paid for verification
  identityVerificationPaidAt?: unknown; // When verification was paid for
  geohash?: string | null; // encoded location for distance-based queries
  isPremium?: boolean; // true if user has Premium subscription (for badge display)
  isElite?: boolean; // @deprecated - use isPremium instead (kept for migration)
  reputationTier?: ReputationTier; // Denormalized from reputation data for efficient display
  
  // NOTE: profileProgress (trust score) and subscription are stored in users/{uid}/private/data
  // for security - only the user can read them, only Cloud Functions can write
  
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
  photoDetails: Photo[]; // Photo objects with URL, privacy, and order info

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
