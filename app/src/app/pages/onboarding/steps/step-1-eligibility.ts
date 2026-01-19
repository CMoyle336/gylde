import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNativeDateAdapter } from '@angular/material/core';
import { OnboardingService } from '../onboarding.service';
import { PlacesService, PlaceSuggestion } from '../../../core/services/places.service';
import { RemoteConfigService } from '../../../core/services/remote-config.service';
import { GeoLocation } from '../../../core/interfaces';

type LocationStatus = 'idle' | 'detecting' | 'success' | 'error' | 'manual';

@Component({
  selector: 'app-step-1-eligibility',
  templateUrl: './step-1-eligibility.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslateModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  providers: [provideNativeDateAdapter()],
})
export class Step1EligibilityComponent implements OnInit, OnDestroy {
  protected readonly onboarding = inject(OnboardingService);
  private readonly placesService = inject(PlacesService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly remoteConfig = inject(RemoteConfigService);
  
  // Show US-only notice when the only allowed region is 'us'
  protected readonly showUsOnlyNotice = computed(() => {
    const regions = this.remoteConfig.allowedRegionCodes();
    return regions.length === 1 && regions[0].toLowerCase() === 'us';
  });

  // Signals for UI state
  protected readonly locationStatus = signal<LocationStatus>('idle');
  protected readonly locationMessage = signal<string | null>(null);
  protected readonly cityInputValue = signal('');
  protected readonly suggestions = signal<PlaceSuggestion[]>([]);
  protected readonly showSuggestions = signal(false);
  protected readonly isSearching = signal(false);
  protected readonly highlightedIndex = signal(-1);
  
  // Birthday signal to avoid creating new Date objects on every change detection
  protected readonly birthDateValue = signal<Date | null>(null);

  // Reference to autocomplete input
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('cityInput');

  // Debounce timer for autocomplete
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Click outside handler
  private clickOutsideHandler = (e: MouseEvent) => this.onClickOutside(e);

  ngOnInit(): void {
    // Only run browser-specific code on the client
    if (isPlatformBrowser(this.platformId)) {
      document.addEventListener('click', this.clickOutsideHandler);
    }

    // Initialize birthDate from stored data
    const data = this.onboarding.data();
    if (data.birthDate) {
      this.birthDateValue.set(new Date(data.birthDate));
    }

    // Check if we already have location data
    if (data.location && data.city) {
      // Format existing location for display
      this.cityInputValue.set(data.city);
      this.locationStatus.set('success');
    } else if (isPlatformBrowser(this.platformId)) {
      // Try to auto-detect location (only in browser)
      this.requestGeolocation();
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.removeEventListener('click', this.clickOutsideHandler);
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  /**
   * Handle birthdate changes from the datepicker
   */
  protected onBirthDateChange(value: Date | null): void {
    this.birthDateValue.set(value);
    if (value) {
      // Convert to ISO string (YYYY-MM-DD)
      const isoString = value.toISOString().split('T')[0];
      this.onboarding.updateData({ birthDate: isoString });
    } else {
      this.onboarding.updateData({ birthDate: null });
    }
  }

  protected get userAge(): number | null {
    const birthDate = this.onboarding.data().birthDate;
    if (!birthDate) return null;
    return this.onboarding.calculateAge(birthDate);
  }

  protected get isAdult(): boolean {
    const age = this.userAge;
    return age !== null && age >= 18;
  }

  protected get hasLocation(): boolean {
    return this.onboarding.data().location !== null;
  }

  // Calculate max date (must be at least 18 years old)
  protected get maxBirthDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date;
  }

  // Calculate min date (reasonable minimum - 100 years ago)
  protected get minBirthDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 100);
    return date;
  }

  /**
   * Request browser geolocation and reverse geocode to get city
   */
  protected requestGeolocation(): void {
    if (!navigator.geolocation) {
      this.locationStatus.set('manual');
      this.locationMessage.set('Geolocation is not supported. Please type your city below.');
      return;
    }

    this.locationStatus.set('detecting');
    this.locationMessage.set(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location: GeoLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        // Reverse geocode to get city info
        const result = await this.placesService.reverseGeocode(
          location.latitude,
          location.longitude
        );

        if (result) {
          // Check if location is in an allowed region
          if (!this.placesService.isAllowedRegion(result.countryCode)) {
            this.locationStatus.set('error');
            this.locationMessage.set('Gylde is not yet available in your region. Please enter a U.S. city below.');
            return;
          }
          
          // Update onboarding data
          this.onboarding.updateData({
            city: result.description,
            country: result.countryCode,
            location: result.location,
          });

          // Update UI
          this.cityInputValue.set(result.description);
          this.locationStatus.set('success');
          this.locationMessage.set('Location detected! You can edit it below if needed.');
        } else {
          // Fallback - save coordinates, let user type city
          this.onboarding.updateData({ location });
          this.locationStatus.set('success');
          this.locationMessage.set('Location detected. Please enter your city below.');
        }
      },
      (error) => {
        this.locationStatus.set('manual');
        switch (error.code) {
          case error.PERMISSION_DENIED:
            this.locationMessage.set('Location access denied. Type your city below.');
            break;
          case error.POSITION_UNAVAILABLE:
            this.locationMessage.set('Location unavailable. Type your city below.');
            break;
          case error.TIMEOUT:
            this.locationMessage.set('Location request timed out. Type your city below.');
            break;
          default:
            this.locationMessage.set('Could not detect location. Type your city below.');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  }

  /**
   * Handle input changes - trigger autocomplete search
   */
  protected onInputChange(value: string): void {
    this.cityInputValue.set(value);
    this.highlightedIndex.set(-1);

    // Clear previous timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    if (!value.trim()) {
      this.suggestions.set([]);
      this.showSuggestions.set(false);
      return;
    }

    // Debounce search
    this.searchDebounceTimer = setTimeout(() => {
      this.searchPlaces(value);
    }, 300);
  }

  /**
   * Search for places matching the input
   */
  private async searchPlaces(query: string): Promise<void> {
    this.isSearching.set(true);

    try {
      const results = await this.placesService.getSuggestions(query);
      this.suggestions.set(results);
      this.showSuggestions.set(results.length > 0);
    } catch (error) {
      console.error('Failed to search places:', error);
      this.suggestions.set([]);
    } finally {
      this.isSearching.set(false);
  }
  }

  /**
   * Handle selecting a suggestion
   */
  protected async selectSuggestion(suggestion: PlaceSuggestion): Promise<void> {
    this.showSuggestions.set(false);
    this.cityInputValue.set(suggestion.description);
    this.isSearching.set(true);

    try {
      const details = await this.placesService.getPlaceDetails(suggestion.placeId);

      if (details) {
        this.onboarding.updateData({
          city: details.description,
          country: details.countryCode,
          location: details.location,
        });

        // Only hide the banner if it was showing 'success' from geolocation
        // Keep 'manual' or 'error' visible so user knows why they had to type
        if (this.locationStatus() === 'success') {
          this.locationStatus.set('idle');
          this.locationMessage.set(null);
        }
      } else {
        // getPlaceDetails returns null for non-allowed regions
        this.locationStatus.set('error');
        this.locationMessage.set('This location is not in an available region. Please select a U.S. city.');
        this.cityInputValue.set('');
      }
    } catch (error) {
      console.error('Failed to get place details:', error);
    } finally {
      this.isSearching.set(false);
    }
  }

  /**
   * Handle keyboard navigation in autocomplete
   */
  protected onKeyDown(event: KeyboardEvent): void {
    const suggestionsList = this.suggestions();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.highlightedIndex.update((i) =>
          i < suggestionsList.length - 1 ? i + 1 : 0
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlightedIndex.update((i) =>
          i > 0 ? i - 1 : suggestionsList.length - 1
        );
        break;
      case 'Enter':
        event.preventDefault();
        const idx = this.highlightedIndex();
        if (idx >= 0 && idx < suggestionsList.length) {
          this.selectSuggestion(suggestionsList[idx]);
        }
        break;
      case 'Escape':
        this.showSuggestions.set(false);
        this.highlightedIndex.set(-1);
        break;
    }
  }

  /**
   * Show suggestions on focus if we have results
   */
  protected onInputFocus(): void {
    if (this.suggestions().length > 0) {
      this.showSuggestions.set(true);
    }
  }

  /**
   * Handle click outside to close suggestions
   */
  private onClickOutside(event: MouseEvent): void {
    const inputEl = this.inputRef()?.nativeElement;
    if (inputEl && !inputEl.contains(event.target as Node)) {
      this.showSuggestions.set(false);
    }
  }

  /**
   * Retry geolocation
   */
  protected retryGeolocation(): void {
    this.locationStatus.set('idle');
    this.locationMessage.set(null);
    this.requestGeolocation();
  }
}
