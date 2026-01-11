/**
 * Discovery and matching interfaces
 */

import { GeoLocation } from './geo.interface';

/**
 * Profile data exposed in discovery/browse views
 */
export interface DiscoverableProfile {
  uid: string;
  displayName: string | null;
  age: number;
  city: string;
  country: string;
  location?: GeoLocation;
  distance?: number; // in miles
  lastActiveAt?: Date; // Last activity timestamp (only if user allows)
  isOnline?: boolean; // True if active in last 15 minutes (only if showOnlineStatus is true)
  showOnlineStatus: boolean; // Whether user allows their online status to be shown
  showLastActive: boolean; // Whether user allows their last active timestamp to be shown
  genderIdentity: string;
  lifestyle: string;
  connectionTypes: string[];
  idealRelationship: string;
  photos: string[];
  verified: boolean;
  values: string[];
  supportOrientation: string[];
  // Secondary profile fields
  ethnicity?: string;
  relationshipStatus?: string;
  children?: string;
  smoker?: string;
  drinker?: string;
  education?: string;
  occupation?: string;
}

/**
 * Enhanced filters for discovery search
 */
export interface DiscoveryFilters {
  // Basic filters
  minAge: number;
  maxAge: number;
  genderIdentity: string[];
  maxDistance: number | null;
  verifiedOnly: boolean;

  // Connection preferences
  connectionTypes: string[];
  supportOrientation: string[];

  // Lifestyle & Values
  lifestyle: string[];
  values: string[];

  // Secondary profile fields
  ethnicity: string[];
  relationshipStatus: string[];
  children: string[];
  smoker: string[];
  drinker: string[];
  education: string[];

  // Activity filters
  onlineNow: boolean;
  activeRecently: boolean;
}

/**
 * Sorting options for discovery
 */
export interface DiscoverySort {
  field: 'distance' | 'lastActive' | 'newest' | 'age';
  direction: 'asc' | 'desc';
}

/**
 * Saved search view
 */
export interface SavedView {
  id: string;
  name: string;
  filters: Partial<DiscoveryFilters>;
  sort: DiscoverySort;
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Search request parameters
 */
export interface SearchRequest {
  filters?: Partial<DiscoveryFilters>;
  sort?: DiscoverySort;
  pagination?: {
    limit?: number;
    cursor?: string;
  };
  location?: GeoLocation;
}

/**
 * Search response from server
 */
export interface SearchResponse {
  profiles: DiscoverableProfile[];
  nextCursor?: string;
  totalEstimate?: number;
}

/**
 * Legacy filter type for backwards compatibility
 * @deprecated Use DiscoveryFilters instead
 */
export type LegacyDiscoveryFilters = {
  maxDistance: number | null;
  verifiedOnly: boolean;
  genderFilter: string[];
  minAge: number;
  maxAge: number;
}
