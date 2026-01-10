import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GeocodingResult, PlacePrediction } from '../interfaces';

interface GoogleGeocodingResponse {
  results: GoogleGeocodingResult[];
  status: string;
}

interface GoogleGeocodingResult {
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: GoogleAddressComponent[];
  place_id: string;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GooglePlacesAutocompleteResponse {
  predictions: GooglePlacePrediction[];
  status: string;
}

interface GooglePlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

@Injectable({
  providedIn: 'root',
})
export class GeocodingService {
  private readonly http = inject(HttpClient);
  private readonly apiKey = environment.googleMapsApiKey;
  private readonly geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json';
  private readonly placesUrl = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';

  /**
   * Reverse geocode: Convert coordinates to address
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<GeocodingResult | null> {
    if (!this.apiKey) {
      console.warn('Google Maps API key not configured');
      return null;
    }

    try {
      const url = `${this.geocodeUrl}?latlng=${latitude},${longitude}&key=${this.apiKey}`;
      const response = await firstValueFrom(
        this.http.get<GoogleGeocodingResponse>(url)
      );

      if (response.status !== 'OK' || response.results.length === 0) {
        console.warn('Geocoding failed:', response.status);
        return null;
      }

      return this.parseGeocodingResult(response.results[0], latitude, longitude);
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }

  /**
   * Forward geocode: Convert address to coordinates
   */
  async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    if (!this.apiKey) {
      console.warn('Google Maps API key not configured');
      return null;
    }

    try {
      const encodedAddress = encodeURIComponent(address);
      const url = `${this.geocodeUrl}?address=${encodedAddress}&key=${this.apiKey}`;
      const response = await firstValueFrom(
        this.http.get<GoogleGeocodingResponse>(url)
      );

      if (response.status !== 'OK' || response.results.length === 0) {
        console.warn('Geocoding failed:', response.status);
        return null;
      }

      const result = response.results[0];
      const { lat, lng } = result.geometry.location;
      return this.parseGeocodingResult(result, lat, lng);
    } catch (error) {
      console.error('Forward geocoding error:', error);
      return null;
    }
  }

  /**
   * Get place predictions for autocomplete
   * Note: This requires a backend proxy in production to protect the API key
   * For now, we'll use a simpler approach with geocoding on blur
   */
  async getPlacePredictions(input: string): Promise<PlacePrediction[]> {
    // In production, this should go through a backend to protect the API key
    // For now, we'll return empty and rely on geocoding the full address
    return [];
  }

  /**
   * Get details for a specific place by ID
   */
  async getPlaceDetails(placeId: string): Promise<GeocodingResult | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const url = `${this.geocodeUrl}?place_id=${placeId}&key=${this.apiKey}`;
      const response = await firstValueFrom(
        this.http.get<GoogleGeocodingResponse>(url)
      );

      if (response.status !== 'OK' || response.results.length === 0) {
        return null;
      }

      const result = response.results[0];
      const { lat, lng } = result.geometry.location;
      return this.parseGeocodingResult(result, lat, lng);
    } catch (error) {
      console.error('Place details error:', error);
      return null;
    }
  }

  private parseGeocodingResult(
    result: GoogleGeocodingResult,
    latitude: number,
    longitude: number
  ): GeocodingResult {
    const components = result.address_components;
    
    let city = '';
    let state = '';
    let country = '';
    let countryCode = '';

    for (const component of components) {
      if (component.types.includes('locality')) {
        city = component.long_name;
      } else if (component.types.includes('administrative_area_level_1')) {
        state = component.short_name;
      } else if (component.types.includes('country')) {
        country = component.long_name;
        countryCode = component.short_name;
      }
      // Fallback for city if locality not found
      if (!city && component.types.includes('administrative_area_level_2')) {
        city = component.long_name;
      }
      if (!city && component.types.includes('sublocality')) {
        city = component.long_name;
      }
    }

    return {
      latitude,
      longitude,
      formattedAddress: result.formatted_address,
      city,
      state,
      country,
      countryCode,
    };
  }
}
