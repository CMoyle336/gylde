/**
 * Photo-related interfaces for private content feature
 */

/**
 * Individual photo with metadata
 */
export interface Photo {
  id: string;
  url: string;
  isPrivate: boolean;
  uploadedAt: Date | unknown;
  order: number; // For sorting/display order
}

/**
 * Private content access request from one user to another
 * Covers both private photos and private posts
 * Stored in: users/{ownerId}/privateAccessRequests/{requesterId}
 */
export interface PrivateAccessRequest {
  requesterId: string;
  requesterName: string;
  requesterPhoto: string | null;
  requestedAt: Date | unknown;
  status: 'pending' | 'granted' | 'denied';
  respondedAt?: Date | unknown;
}

/**
 * Private content access grant - who has been granted access to private content
 * Covers both private photos and private posts
 * Stored in: users/{ownerId}/privateAccessGrants/{grantedToUserId}
 */
export interface PrivateAccessGrant {
  grantedToUserId: string;
  grantedToName: string;
  grantedToPhoto: string | null;
  grantedAt: Date | unknown;
}

/**
 * Summary of private content access for display in profile
 */
export interface PrivateAccessSummary {
  hasAccess: boolean;
  requestStatus?: 'pending' | 'granted' | 'denied';
  requestedAt?: Date;
}

// Legacy aliases for backward compatibility during migration
/** @deprecated Use PrivateAccessRequest instead */
export type PhotoAccessRequest = PrivateAccessRequest;
/** @deprecated Use PrivateAccessGrant instead */
export type PhotoAccessGrant = PrivateAccessGrant;
/** @deprecated Use PrivateAccessSummary instead */
export type PhotoAccessSummary = PrivateAccessSummary;
