import { Injectable, inject, signal, computed } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { UserProfileService } from './user-profile.service';
import { AuthService } from './auth.service';
import {
  DiscoverableProfile,
  DiscoveryFilters,
  DiscoverySort,
  SavedView,
  SearchRequest,
  SearchResponse,
} from '../interfaces';
import { ALL_CONNECTION_TYPES } from '../constants/connection-types';

const DEFAULT_FILTERS: DiscoveryFilters = {
  minAge: 18,
  maxAge: 99,
  genderIdentity: [],
  maxDistance: null,
  verifiedOnly: false,
  connectionTypes: [],
  supportOrientation: [],
  ethnicity: [],
  relationshipStatus: [],
  children: [],
  smoker: [],
  drinker: [],
  education: [],
  height: [],
  income: [],
  onlineNow: false,
  activeRecently: false,
};

const DEFAULT_SORT: DiscoverySort = {
  field: 'lastActive',
  direction: 'desc',
};

@Injectable({
  providedIn: 'root',
})
export class DiscoveryService {
  private readonly functions = inject(Functions);
  private readonly userProfileService = inject(UserProfileService);
  private readonly authService = inject(AuthService);

  // State signals
  private readonly _profiles = signal<DiscoverableProfile[]>([]);
  private readonly _loading = signal(false);
  private readonly _initialized = signal(false); // Tracks if we've ever done a search
  private readonly _filters = signal<DiscoveryFilters>({ ...DEFAULT_FILTERS });
  private readonly _sort = signal<DiscoverySort>({ ...DEFAULT_SORT });
  private readonly _savedViews = signal<SavedView[]>([]);
  private readonly _activeView = signal<SavedView | null>(null);
  private readonly _nextCursor = signal<string | undefined>(undefined);
  private readonly _totalEstimate = signal<number | undefined>(undefined);
  private readonly _hasMore = signal(true);

  // Public readonly signals
  readonly profiles = this._profiles.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly sort = this._sort.asReadonly();
  readonly savedViews = this._savedViews.asReadonly();
  readonly activeView = this._activeView.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly totalEstimate = this._totalEstimate.asReadonly();

  // Computed: check if any filters are active (excludes profile-based filters)
  readonly hasActiveFilters = computed(() => {
    const filters = this._filters();

    // Note: minAge, maxAge, and genderIdentity are derived from profile, not counted
    return (
      filters.maxDistance !== null ||
      filters.verifiedOnly ||
      filters.connectionTypes.length > 0 ||
      filters.supportOrientation.length > 0 ||
      filters.ethnicity.length > 0 ||
      filters.relationshipStatus.length > 0 ||
      filters.children.length > 0 ||
      filters.smoker.length > 0 ||
      filters.drinker.length > 0 ||
      filters.education.length > 0 ||
      filters.height.length > 0 ||
      filters.income.length > 0 ||
      filters.onlineNow ||
      filters.activeRecently
    );
  });

  // Computed: active filter count (excludes profile-based filters like age/gender)
  readonly activeFilterCount = computed(() => {
    const filters = this._filters();
    let count = 0;

    // Note: minAge, maxAge, and genderIdentity are derived from profile, not counted
    if (filters.maxDistance !== null) count++;
    if (filters.verifiedOnly) count++;
    if (filters.connectionTypes.length > 0) count++;
    if (filters.supportOrientation.length > 0) count++;
    if (filters.ethnicity.length > 0) count++;
    if (filters.relationshipStatus.length > 0) count++;
    if (filters.children.length > 0) count++;
    if (filters.smoker.length > 0) count++;
    if (filters.drinker.length > 0) count++;
    if (filters.education.length > 0) count++;
    if (filters.height.length > 0) count++;
    if (filters.income.length > 0) count++;
    if (filters.onlineNow) count++;
    if (filters.activeRecently) count++;

    return count;
  });

  /**
   * Search profiles using the Cloud Function
   * @param loadMore - If true, load more results (pagination)
   * @param forceRefresh - If true, always show loading state and clear existing results
   */
  async searchProfiles(loadMore = false, forceRefresh = false): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    // Only show loading state if we don't have cached results (or force refresh)
    // This prevents the flash when returning to the discover page
    const hasExistingProfiles = this._profiles().length > 0;
    
    if (!loadMore) {
      if (!hasExistingProfiles || forceRefresh) {
        this._loading.set(true);
        if (forceRefresh) {
          this._profiles.set([]); // Clear existing results on force refresh
        }
      }
      this._nextCursor.set(undefined);
    }

    try {
      // Get current user's profile for location and preferences
      const currentProfile = this.userProfileService.profile();
      const location = currentProfile?.onboarding?.location;

      // Get user's dating preferences from their profile
      const userAgeRangeMin = currentProfile?.onboarding?.ageRangeMin ?? 18;
      const userAgeRangeMax = currentProfile?.onboarding?.ageRangeMax ?? 99;
      const userInterestedIn = currentProfile?.onboarding?.interestedIn ?? [];

      // Map "interested in" preferences to gender identity values
      // User profile stores: 'men', 'women', 'nonbinary'
      // Profile genderIdentity stores: 'man', 'woman', 'nonbinary'
      const genderFilter = userInterestedIn.map((interest: string) => {
        if (interest === 'men') return 'man';
        if (interest === 'women') return 'woman';
        return interest;
      });

      // Build search request with profile-based filters merged in
      const userFilters = this._filters();
      const request: SearchRequest = {
        filters: {
          ...userFilters,
          minAge: userAgeRangeMin,
          maxAge: userAgeRangeMax,
          genderIdentity: genderFilter,
        },
        sort: this._sort(),
        pagination: {
          limit: 20,
          cursor: loadMore ? this._nextCursor() : undefined,
        },
        location,
      };

      // Call Cloud Function
      const searchFn = httpsCallable<SearchRequest, SearchResponse>(
        this.functions,
        'searchProfiles'
      );

      const result = await searchFn(request);
      const response = result.data;

      // Map response to DiscoverableProfile format
      const newProfiles: DiscoverableProfile[] = response.profiles.map(p => ({
        ...p,
        lastActiveAt: p.lastActiveAt ? new Date(p.lastActiveAt) : undefined,
      }));

      if (loadMore) {
        this._profiles.update(current => [...current, ...newProfiles]);
      } else {
        this._profiles.set(newProfiles);
      }

      this._nextCursor.set(response.nextCursor);
      this._totalEstimate.set(response.totalEstimate);
      this._hasMore.set(!!response.nextCursor);
    } catch (error) {
      console.error('Failed to search profiles:', error);
      // Only clear profiles on error if this was a fresh search with no existing data
      if (!loadMore && !hasExistingProfiles) {
        this._profiles.set([]);
      }
    } finally {
      this._loading.set(false);
      this._initialized.set(true);
    }
  }

  /**
   * Load more profiles (pagination)
   */
  async loadMore(): Promise<void> {
    if (this._loading() || !this._hasMore()) return;
    await this.searchProfiles(true);
  }

  /**
   * Update filters and re-search
   */
  updateFilters(updates: Partial<DiscoveryFilters>): void {
    this._filters.update(current => ({ ...current, ...updates }));
    this._activeView.set(null); // Clear active view when filters change
  }

  /**
   * Update sort and re-search
   */
  updateSort(sort: DiscoverySort): void {
    this._sort.set(sort);
    this._activeView.set(null);
  }

  /**
   * Reset filters to defaults
   */
  resetFilters(): void {
    this._filters.set({ ...DEFAULT_FILTERS });
    this._activeView.set(null);
  }

  /**
   * Reset sort to default
   */
  resetSort(): void {
    this._sort.set({ ...DEFAULT_SORT });
  }

  /**
   * Apply a saved view
   */
  applyView(view: SavedView): void {
    this._filters.set({
      ...DEFAULT_FILTERS,
      ...view.filters,
    });
    this._sort.set(view.sort);
    this._activeView.set(view);
  }

  /**
   * Save current filters/sort as a view
   */
  async saveView(name: string, isDefault = false): Promise<string | null> {
    const currentUser = this.authService.user();
    if (!currentUser) return null;

    try {
      const saveFn = httpsCallable<
        { name: string; filters: DiscoveryFilters; sort: DiscoverySort; isDefault: boolean },
        { id: string }
      >(this.functions, 'saveSearchView');

      const result = await saveFn({
        name,
        filters: this._filters(),
        sort: this._sort(),
        isDefault,
      });

      // Reload saved views
      await this.loadSavedViews();

      return result.data.id;
    } catch (error) {
      console.error('Failed to save view:', error);
      return null;
    }
  }

  /**
   * Load user's saved views
   */
  async loadSavedViews(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const getFn = httpsCallable<void, SavedView[]>(
        this.functions,
        'getSavedViews'
      );

      const result = await getFn();
      this._savedViews.set(result.data);

      // Apply default view if exists and no active view
      const defaultView = result.data.find(v => v.isDefault);
      if (defaultView && !this._activeView()) {
        this.applyView(defaultView);
      }
    } catch (error) {
      console.error('Failed to load saved views:', error);
    }
  }

  /**
   * Delete a saved view
   */
  async deleteView(viewId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const deleteFn = httpsCallable<{ viewId: string }, void>(
        this.functions,
        'deleteSearchView'
      );

      await deleteFn({ viewId });

      // Update local state
      this._savedViews.update(views => views.filter(v => v.id !== viewId));

      // Clear active view if it was deleted
      if (this._activeView()?.id === viewId) {
        this._activeView.set(null);
      }
    } catch (error) {
      console.error('Failed to delete view:', error);
    }
  }

  /**
   * Set a view as the default
   */
  async setDefaultView(viewId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const setDefaultFn = httpsCallable<{ viewId: string }, void>(
        this.functions,
        'setDefaultView'
      );

      await setDefaultFn({ viewId });

      // Update local state
      this._savedViews.update(views =>
        views.map(v => ({
          ...v,
          isDefault: v.id === viewId,
        }))
      );
    } catch (error) {
      console.error('Failed to set default view:', error);
    }
  }

  // ==================
  // Filter option lists
  // ==================

  readonly genderOptions = [
    { value: 'man', label: 'Men' },
    { value: 'woman', label: 'Women' },
    { value: 'nonbinary', label: 'Non-binary' },
  ];

  readonly connectionTypeOptions = ALL_CONNECTION_TYPES;

  readonly ethnicityOptions = [
    'Asian', 'Black/African', 'Hispanic/Latino', 'Middle Eastern',
    'Native American', 'Pacific Islander', 'White/Caucasian', 'Mixed', 'Other',
  ];

  readonly relationshipStatusOptions = [
    'Single', 'Divorced', 'Separated', 'Widowed', 'In a relationship', 'Married',
  ];

  readonly childrenOptions = [
    'No children', 'Have children', 'Want children', "Don't want children", 'Open to children',
  ];

  readonly smokerOptions = [
    'Never', 'Occasionally', 'Socially', 'Regularly', 'Trying to quit',
  ];

  readonly drinkerOptions = [
    'Never', 'Occasionally', 'Socially', 'Regularly',
  ];

  readonly educationOptions = [
    'High school', 'Some college', 'Associate degree', "Bachelor's degree",
    "Master's degree", 'Doctorate', 'Trade school',
  ];

  readonly heightOptions = [
    "Under 5'0\"", "5'0\" - 5'3\"", "5'4\" - 5'6\"", "5'7\" - 5'9\"",
    "5'10\" - 6'0\"", "6'1\" - 6'3\"", "Over 6'3\"",
  ];

  readonly incomeOptions = [
    'Under $50,000', '$50,000 - $100,000', '$100,000 - $150,000',
    '$150,000 - $250,000', '$250,000 - $500,000', '$500,000+', 'Prefer not to say',
  ];

  readonly supportOrientationOptions = [
    { value: 'provider', label: 'Provider' },
    { value: 'receiver', label: 'Receiver' },
    { value: 'flexible', label: 'Flexible' },
  ];

  readonly distanceOptions = [
    { value: 10, label: 'Within 10 mi' },
    { value: 25, label: 'Within 25 mi' },
    { value: 50, label: 'Within 50 mi' },
    { value: 100, label: 'Within 100 mi' },
    { value: 250, label: 'Within 250 mi' },
    { value: null, label: 'Any distance' },
  ];

  readonly sortOptions: { value: DiscoverySort; label: string }[] = [
    { value: { field: 'lastActive', direction: 'desc' }, label: 'Recently Active' },
    { value: { field: 'distance', direction: 'asc' }, label: 'Nearest' },
    { value: { field: 'newest', direction: 'desc' }, label: 'Newest Profiles' },
    { value: { field: 'age', direction: 'asc' }, label: 'Age (Youngest)' },
    { value: { field: 'age', direction: 'desc' }, label: 'Age (Oldest)' },
  ];
}
