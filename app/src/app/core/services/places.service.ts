import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { GeoLocation } from '../interfaces';
import { RemoteConfigService } from './remote-config.service';

export interface PlaceResult {
  placeId: string;
  description: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  location: GeoLocation;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

@Injectable({
  providedIn: 'root',
})
export class PlacesService {
  private readonly remoteConfig = inject(RemoteConfigService);
  private isLoaded = signal(false);
  private isLoading = signal(false);

  /**
   * Load Google Maps JavaScript API with the new Places library
   */
  async loadGoogleMaps(): Promise<boolean> {
    if (this.isLoaded()) {
      return true;
    }

    if (this.isLoading()) {
      return new Promise((resolve) => {
        const checkLoaded = setInterval(() => {
          if (this.isLoaded()) {
            clearInterval(checkLoaded);
            resolve(true);
          }
        }, 100);
      });
    }

    if (!environment.googleMapsApiKey) {
      console.warn('Google Maps API key not configured');
      return false;
    }

    this.isLoading.set(true);

    return new Promise((resolve) => {
      // Check if already loaded (including Geocoder)
      if (
        typeof google !== 'undefined' &&
        google.maps &&
        google.maps.places &&
        google.maps.Geocoder
      ) {
        this.isLoaded.set(true);
        this.isLoading.set(false);
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      // Load with places library (Geocoder is in core)
      script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}&libraries=places`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.isLoaded.set(true);
        this.isLoading.set(false);
        resolve(true);
      };

      script.onerror = () => {
        console.error('Failed to load Google Maps API');
        this.isLoading.set(false);
        resolve(false);
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Get city suggestions for autocomplete using the new Places API
   */
  async getSuggestions(input: string): Promise<PlaceSuggestion[]> {
    if (!input.trim() || input.length < 2) {
      return [];
    }

    const loaded = await this.loadGoogleMaps();
    if (!loaded) {
      return [];
    }

    try {
      // Use the new AutocompleteSuggestion API with region filtering from Remote Config
      const allowedRegions = this.remoteConfig.allowedRegionCodes();
      const { suggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          includedPrimaryTypes: ['locality', 'administrative_area_level_3', 'postal_town'],
          includedRegionCodes: allowedRegions,
        });

      return suggestions
        .filter((s) => s.placePrediction)
        .map((s) => {
          const prediction = s.placePrediction!;
          return {
            placeId: prediction.placeId,
            description: prediction.text.text,
            mainText: prediction.mainText?.text || prediction.text.text,
            secondaryText: prediction.secondaryText?.text || '',
          };
        });
    } catch (error) {
      console.error('Failed to fetch autocomplete suggestions:', error);
      return [];
    }
  }

  /**
   * Get full place details using the new Place class
   * Returns null if the place is not in an allowed region
   */
  async getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
    const loaded = await this.loadGoogleMaps();
    if (!loaded) {
      return null;
    }

    try {
      const place = new google.maps.places.Place({ id: placeId });

      await place.fetchFields({
        fields: ['location', 'addressComponents', 'formattedAddress', 'displayName'],
      });

      const result = this.parsePlaceResult(placeId, place);
      
      // Validate that the place is in an allowed region
      if (result && !this.isAllowedRegion(result.countryCode)) {
        console.warn(`Place rejected: ${result.countryCode} is not in allowed regions`);
        return null;
      }
      
      return result;
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      return null;
    }
  }
  
  /**
   * Check if a country code is in the allowed regions
   */
  isAllowedRegion(countryCode: string): boolean {
    const allowedCodes = this.remoteConfig.allowedRegionCodes().map(c => c.toUpperCase());
    return allowedCodes.includes(countryCode.toUpperCase());
  }

  private parsePlaceResult(
    placeId: string,
    place: google.maps.places.Place
  ): PlaceResult | null {
    if (!place.location || !place.addressComponents) {
      return null;
    }

    let city = '';
    let state = '';
    let country = '';
    let countryCode = '';

    for (const component of place.addressComponents) {
      const types = component.types;

      if (types.includes('locality')) {
        city = component.longText || '';
      } else if (types.includes('administrative_area_level_1')) {
        state = component.shortText || '';
      } else if (types.includes('country')) {
        country = component.longText || '';
        countryCode = component.shortText || '';
      }
      // Fallbacks
      if (!city && types.includes('administrative_area_level_2')) {
        city = component.longText || '';
      }
      if (!city && types.includes('postal_town')) {
        city = component.longText || '';
      }
    }

    return {
      placeId,
      description: place.formattedAddress || `${city}, ${state}, ${country}`,
      city,
      state,
      country,
      countryCode,
      location: {
        latitude: place.location.lat(),
        longitude: place.location.lng(),
      },
    };
  }

  /**
   * Reverse geocode coordinates to get place info
   * Note: Geocoding API is separate from Places API (New)
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<PlaceResult | null> {
    const loaded = await this.loadGoogleMaps();
    if (!loaded) {
      return null;
    }

    try {
      const geocoder = new google.maps.Geocoder();

      const response = await geocoder.geocode({
        location: { lat: latitude, lng: longitude },
      });

      if (!response.results || response.results.length === 0) {
        return null;
      }

      // Find the best result - prioritize locality (city) over county
      // First try to find a result with 'locality' type
      let cityResult = response.results.find((r) => r.types.includes('locality'));
      
      // If no locality found, try sublocality
      if (!cityResult) {
        cityResult = response.results.find((r) => r.types.includes('sublocality'));
      }
      
      // If still no result, try postal_town (common in UK)
      if (!cityResult) {
        cityResult = response.results.find((r) => r.types.includes('postal_town'));
      }
      
      // Last resort: use administrative_area_level_2 (county) or first result
      if (!cityResult) {
        cityResult = response.results.find((r) =>
          r.types.includes('administrative_area_level_2')
        ) || response.results[0];
      }

      let city = '';
      let state = '';
      let country = '';
      let countryCode = '';

      // Extract city name - check ALL results for a locality name
      // Sometimes the locality is in the first (most specific) result's components
      for (const result of response.results) {
        for (const component of result.address_components) {
          if (component.types.includes('locality') && !city) {
            city = component.long_name;
          }
          if (component.types.includes('administrative_area_level_1') && !state) {
            state = component.short_name;
          }
          if (component.types.includes('country') && !country) {
            country = component.long_name;
            countryCode = component.short_name;
          }
        }
        // Stop if we found a city
        if (city && state && country) break;
      }

      // Fallbacks if no locality found
      if (!city) {
        for (const component of cityResult.address_components) {
          const types = component.types;
          if (types.includes('sublocality') || types.includes('neighborhood')) {
            city = component.long_name;
            break;
          }
          if (types.includes('postal_town')) {
            city = component.long_name;
            break;
          }
          if (types.includes('administrative_area_level_2')) {
            city = component.long_name;
            break;
          }
        }
      }

      return {
        placeId: cityResult.place_id,
        description: `${city}, ${state}, ${country}`.replace(/^, |, $/g, ''),
        city,
        state,
        country,
        countryCode,
        location: { latitude, longitude },
      };
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return null;
    }
  }
}
