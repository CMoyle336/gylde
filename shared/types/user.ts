/**
 * User types - shared between client and server
 */

import { GeoLocation } from './geo';

/**
 * Main user profile document structure
 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: unknown; // Date on client, Timestamp on server
  updatedAt: unknown;
  onboardingCompleted: boolean;

  // Onboarding data (populated after onboarding)
  onboarding?: OnboardingProfile;
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
  supportOrientation: string[];

  // Step 5: Values & Lifestyle
  values: string[];
  lifestyle: string;

  // Step 6: Open-Ended Prompts
  idealRelationship: string;
  supportMeaning?: string;

  // Step 7: Photos
  photos: string[];

  // Step 8: Verification
  verificationOptions: string[];
}
