/**
 * Photo-related type definitions for Cloud Functions
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
 * Photo access request from one user to another
 */
export interface PhotoAccessRequest {
  requesterId: string;
  requesterName: string;
  requesterPhoto: string | null;
  requestedAt: Timestamp;
  status: "pending" | "granted" | "denied";
  respondedAt?: Timestamp;
}

/**
 * Photo access grant
 */
export interface PhotoAccessGrant {
  grantedToUserId: string;
  grantedToName: string;
  grantedToPhoto: string | null;
  grantedAt: Timestamp;
}
