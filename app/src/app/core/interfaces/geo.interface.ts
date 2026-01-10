/**
 * Geographic location interfaces
 * Re-exports shared types and adds client-specific extensions
 */

// Re-export shared types
export type { GeoLocation, GeocodingResult } from '@gylde/shared';

/**
 * Google Places autocomplete prediction (client-only)
 */
export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}
