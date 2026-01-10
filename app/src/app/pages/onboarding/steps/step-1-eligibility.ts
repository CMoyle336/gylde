import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import { PlacesService, PlaceSuggestion } from '../../../core/services/places.service';
import { GeoLocation } from '../../../core/interfaces';

type LocationStatus = 'idle' | 'detecting' | 'success' | 'error' | 'manual';

@Component({
  selector: 'app-step-1-eligibility',
  templateUrl: './step-1-eligibility.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step1EligibilityComponent implements OnInit, OnDestroy {
  protected readonly onboarding = inject(OnboardingService);
  private readonly placesService = inject(PlacesService);

  // Signals for UI state
  protected readonly locationStatus = signal<LocationStatus>('idle');
  protected readonly locationMessage = signal<string | null>(null);
  protected readonly cityInputValue = signal('');
  protected readonly suggestions = signal<PlaceSuggestion[]>([]);
  protected readonly showSuggestions = signal(false);
  protected readonly isSearching = signal(false);
  protected readonly highlightedIndex = signal(-1);

  // Reference to autocomplete input
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('cityInput');

  // Debounce timer for autocomplete
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Click outside handler
  private clickOutsideHandler = (e: MouseEvent) => this.onClickOutside(e);

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutsideHandler);

    // Check if we already have location data
    const data = this.onboarding.data();
    if (data.location && data.city) {
      // Format existing location for display
      this.cityInputValue.set(data.city);
      this.locationStatus.set('success');
    } else {
      // Try to auto-detect location
      this.requestGeolocation();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutsideHandler);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  protected get isAdult(): boolean | null {
    return this.onboarding.data().isAdult;
  }

  protected set isAdult(value: boolean | null) {
    this.onboarding.updateData({ isAdult: value });
  }

  protected get hasLocation(): boolean {
    return this.onboarding.data().location !== null;
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
