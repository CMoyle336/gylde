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
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
}
