/**
 * User-related type definitions
 */

import {Timestamp} from "firebase-admin/firestore";

export interface UserDisplayInfo {
  displayName?: string;
  photoURL?: string;
  email?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
}
// Note: Email is NOT stored in user profile - use Firebase Auth for email

/**
 * Founder status fields stored on the user document
 * Founders are the first 50 members of a given city/region
 */
export interface FounderStatus {
  // Whether the user is a founder
  isFounder: boolean;

  // The city they're a founder for (immutable after set)
  founderCity: string;

  // Normalized city name used for tracking
  founderCityNormalized: string;

  // When founder status was granted
  founderGrantedAt: Timestamp;
}
