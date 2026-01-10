import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { UserProfileService } from './user-profile.service';
import { AuthService } from './auth.service';
import { DiscoverableProfile, DiscoveryFilters, UserProfile, GeoLocation } from '../interfaces';

const DEFAULT_FILTERS: DiscoveryFilters = {
  maxDistance: 50, // Default 50 miles
  verifiedOnly: false,
  genderFilter: [],
  minAge: 18,
  maxAge: 99,
};

@Injectable({
  providedIn: 'root',
})
export class DiscoveryService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly authService = inject(AuthService);

  private readonly _profiles = signal<DiscoverableProfile[]>([]);
  private readonly _loading = signal(false);
  private readonly _filters = signal<DiscoveryFilters>({ ...DEFAULT_FILTERS });

  readonly profiles = this._profiles.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filters = this._filters.asReadonly();

  // Filtered and sorted profiles
  readonly filteredProfiles = computed(() => {
    const profiles = this._profiles();
    const filters = this._filters();
    const currentUserProfile = this.userProfileService.profile();
    const currentLocation = currentUserProfile?.onboarding?.location;

    let filtered = profiles;

    // Filter by verified
    if (filters.verifiedOnly) {
      filtered = filtered.filter(p => p.verified);
    }

    // Filter by gender
    if (filters.genderFilter.length > 0) {
      filtered = filtered.filter(p => filters.genderFilter.includes(p.genderIdentity));
    }

    // Filter by age
    filtered = filtered.filter(p => p.age >= filters.minAge && p.age <= filters.maxAge);

    // Filter by distance (only if we have location data)
    if (filters.maxDistance !== null && currentLocation) {
      filtered = filtered.filter(p => {
        if (!p.distance) return true; // Include profiles without location
        return p.distance <= filters.maxDistance!;
      });
    }

    // Sort by distance if available
    return filtered.sort((a, b) => {
      // Profiles with distance come first, sorted by distance
      if (a.distance !== undefined && b.distance !== undefined) {
        return a.distance - b.distance;
      }
      if (a.distance !== undefined) return -1;
      if (b.distance !== undefined) return 1;
      return 0;
    });
  });

  async loadProfiles(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    this._loading.set(true);

    try {
      // Load current user's profile to get their preferences and location
      let currentProfile = this.userProfileService.profile();
      if (!currentProfile) {
        currentProfile = await this.userProfileService.loadUserProfile(currentUser.uid);
      }

      const currentLocation = currentProfile?.onboarding?.location;
      const interestedIn = currentProfile?.onboarding?.interestedIn || [];

      // Fetch all completed profiles
      const allProfiles = await this.firestoreService.getCollection<UserProfile>(
        'users',
        [this.firestoreService.whereEqual('onboardingCompleted', true)]
      );

      // Filter out current user and map to discoverable profiles
      const discoverableProfiles: DiscoverableProfile[] = allProfiles
        .filter(p => p.uid !== currentUser.uid)
        .filter(p => p.onboarding) // Must have onboarding data
        .filter(p => {
          // Filter by user's interested in preferences
          if (interestedIn.length === 0) return true;
          const profileGender = p.onboarding!.genderIdentity;
          return interestedIn.some(interest => {
            if (interest === 'men' && profileGender === 'man') return true;
            if (interest === 'women' && profileGender === 'woman') return true;
            if (interest === 'nonbinary' && profileGender === 'nonbinary') return true;
            return false;
          });
        })
        .map(p => this.mapToDiscoverableProfile(p, currentLocation));

      this._profiles.set(discoverableProfiles);
    } catch (error) {
      console.error('Failed to load profiles:', error);
      this._profiles.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  updateFilters(updates: Partial<DiscoveryFilters>): void {
    this._filters.update(current => ({ ...current, ...updates }));
  }

  resetFilters(): void {
    this._filters.set({ ...DEFAULT_FILTERS });
  }

  setMaxDistance(distance: number | null): void {
    this._filters.update(f => ({ ...f, maxDistance: distance }));
  }

  private mapToDiscoverableProfile(
    profile: UserProfile,
    currentLocation?: GeoLocation
  ): DiscoverableProfile {
    const onboarding = profile.onboarding!;
    
    // Calculate age from a default birth year (in real app, would need birthdate)
    // For now, use a random age between 25-45 for demo
    const age = Math.floor(Math.random() * 20) + 25;

    // Calculate distance if both locations are available
    let distance: number | undefined;
    if (currentLocation && onboarding.location) {
      distance = this.calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        onboarding.location.latitude,
        onboarding.location.longitude
      );
    }

    return {
      uid: profile.uid,
      displayName: profile.displayName,
      age,
      city: onboarding.city,
      country: onboarding.country,
      location: onboarding.location,
      distance,
      genderIdentity: onboarding.genderIdentity,
      lifestyle: onboarding.lifestyle,
      connectionTypes: onboarding.connectionTypes,
      idealRelationship: onboarding.idealRelationship,
      photos: onboarding.photos,
      verified: onboarding.verificationOptions?.includes('identity') || false,
      values: onboarding.values,
      supportOrientation: onboarding.supportOrientation,
    };
  }

  /**
   * Calculate distance between two coordinates using the Haversine formula
   * Returns distance in miles
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
