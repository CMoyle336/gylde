/**
 * User-related type definitions
 */

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
