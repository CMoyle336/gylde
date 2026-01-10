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
  genderIdentity: string;
  lifestyle: string;
  connectionTypes: string[];
  idealRelationship: string;
  photos: string[];
  verified: boolean;
  values: string[];
  supportOrientation: string[];
}

/**
 * Filters for discovery search
 */
export interface DiscoveryFilters {
  maxDistance: number | null; // in miles, null = no limit
  verifiedOnly: boolean;
  genderFilter: string[]; // empty = all
  minAge: number;
  maxAge: number;
}
