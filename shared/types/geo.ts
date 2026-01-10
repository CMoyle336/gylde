/**
 * Geographic types - shared between client and server
 */

/**
 * Basic geographic coordinates
 */
export interface GeoLocation {
  latitude: number;
  longitude: number;
}

/**
 * Result from geocoding operations (forward or reverse)
 */
export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
}
