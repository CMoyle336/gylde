/**
 * Photo-related interfaces for private photo feature
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
 * Photo access request from one user to another
 * Stored in: users/{ownerId}/photoAccessRequests/{requesterId}
 */
export interface PhotoAccessRequest {
  requesterId: string;
  requesterName: string;
  requesterPhoto: string | null;
  requestedAt: Date | unknown;
  status: 'pending' | 'granted' | 'denied';
  respondedAt?: Date | unknown;
}

/**
 * Photo access grant - who has been granted access to private photos
 * Stored in: users/{ownerId}/photoAccessGrants/{grantedToUserId}
 */
export interface PhotoAccessGrant {
  grantedToUserId: string;
  grantedToName: string;
  grantedToPhoto: string | null;
  grantedAt: Date | unknown;
}

/**
 * Summary of photo access for display in profile
 */
export interface PhotoAccessSummary {
  hasAccess: boolean;
  requestStatus?: 'pending' | 'granted' | 'denied';
  requestedAt?: Date;
}
