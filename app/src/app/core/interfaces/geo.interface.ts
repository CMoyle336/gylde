/**
 * Geographic location interfaces
 * Used across onboarding, discovery, and geocoding services
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

/**
 * Google Places autocomplete prediction
 */
export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}
