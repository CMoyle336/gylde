/**
 * Authentication-related interfaces
 */

/**
 * Mapped Firebase user for application use
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

/**
 * Result emitted after authentication completes
 */
export interface AuthResult {
  isNewUser: boolean;
}
