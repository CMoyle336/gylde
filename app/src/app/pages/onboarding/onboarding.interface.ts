/**
 * Onboarding flow interfaces
 * Used during the onboarding wizard
 */

import { GeoLocation } from '../../core/interfaces/geo.interface';

/**
 * Onboarding wizard state data
 * This is the in-progress form data before saving to profile
 */
export interface OnboardingData {
  // Step 1: Eligibility
  birthDate: string | null; // ISO date string (YYYY-MM-DD)
  city: string;
  country: string;
  location: GeoLocation | null;

  // Step 2: Dating Identity
  genderIdentity: string;
  genderCustom: string;
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
  supportMeaning: string;

  // Step 7: Photos
  photos: string[];

  // Step 8: Verification
  verificationOptions: string[];
}
