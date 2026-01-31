/**
 * Photo and private content type definitions for Cloud Functions
 */

import {Timestamp} from "firebase-admin/firestore";

/**
 * Individual photo with metadata
 */
export interface Photo {
  id: string;
  url: string;
  isPrivate: boolean;
  uploadedAt: Timestamp;
  order: number;
}

/**
 * Private content access request from one user to another
 * Covers both private photos and private posts
 */
export interface PrivateAccessRequest {
  requesterId: string;
  requesterName: string;
  requesterPhoto: string | null;
  requestedAt: Timestamp;
  status: "pending" | "granted" | "denied";
  respondedAt?: Timestamp;
}

/**
 * Private content access grant
 * Covers both private photos and private posts
 */
export interface PrivateAccessGrant {
  grantedToUserId: string;
  grantedToName: string;
  grantedToPhoto: string | null;
  grantedAt: Timestamp;
}

// Legacy aliases for backward compatibility during migration
/** @deprecated Use PrivateAccessRequest instead */
export type PhotoAccessRequest = PrivateAccessRequest;
/** @deprecated Use PrivateAccessGrant instead */
export type PhotoAccessGrant = PrivateAccessGrant;
