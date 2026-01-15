import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BlockService } from './block.service';
import { UserProfile } from '../interfaces';

interface FavoriteDoc {
  id?: string;
  fromUserId: string;
  toUserId?: string;
  odTargetUserId?: string; // Legacy format
  private?: boolean;
  createdAt: unknown;
}

interface ProfileViewDoc {
  id?: string;
  viewerId: string;
  viewedUserId: string;
  viewedAt: unknown;
}

interface MatchDoc {
  id?: string;
  users: string[];
  createdAt: unknown;
}

export interface MatchProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
  age: number | null;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  isOnline: boolean;
  showOnlineStatus: boolean;
  showLastActive: boolean;
  showLocation: boolean;
  lastActiveAt: Date | null;
  interactionDate: Date; // When the favorite/view happened
  // Additional fields for profile card
  connectionTypes: string[];
  tagline: string;
  photos: string[];
}

export type MatchTab = 'my-matches' | 'favorited-me' | 'viewed-me' | 'my-favorites' | 'my-views';

const STORAGE_KEY_PREFIX = 'matches_last_viewed_';

@Injectable({
  providedIn: 'root',
})
export class MatchesService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);
  private readonly blockService = inject(BlockService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _loading = signal(false);
  private readonly _initialized = signal(false); // Tracks if we've ever loaded data
  private readonly _activeTab = signal<MatchTab>('my-matches');
  private readonly _profiles = signal<MatchProfile[]>([]);
  private readonly _favoritedMeCount = signal(0);
  private readonly _viewedMeCount = signal(0);
  
  // Cache profiles per tab to avoid showing loading state on return navigation
  private readonly _cachedProfiles = new Map<MatchTab, MatchProfile[]>();

  readonly loading = this._loading.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly activeTab = this._activeTab.asReadonly();
  readonly profiles = this._profiles.asReadonly();
  readonly favoritedMeCount = this._favoritedMeCount.asReadonly();
  readonly viewedMeCount = this._viewedMeCount.asReadonly();

  readonly isEmpty = computed(() => this._initialized() && !this._loading() && this._profiles().length === 0);

  /**
   * Remove a profile from the current view and cache
   * Used when unfavoriting from the my-favorites tab
   */
  removeProfile(userId: string): void {
    const tab = this._activeTab();
    
    // Remove from current profiles
    this._profiles.update(profiles => 
      profiles.filter(p => p.uid !== userId)
    );
    
    // Remove from cache for this tab
    const cached = this._cachedProfiles.get(tab);
    if (cached) {
      this._cachedProfiles.set(tab, cached.filter(p => p.uid !== userId));
    }
  }

  /**
   * Set the active tab and load profiles for that tab
   * Also resets the badge count for the viewed tab
   */
  async setTab(tab: MatchTab): Promise<void> {
    this._activeTab.set(tab);
    
    // Mark tab as viewed (reset badge)
    if (tab === 'favorited-me') {
      this.markTabAsViewed('favorited-me');
      this._favoritedMeCount.set(0);
    } else if (tab === 'viewed-me') {
      this.markTabAsViewed('viewed-me');
      this._viewedMeCount.set(0);
    }
    
    await this.loadProfiles();
  }

  /**
   * Load badge counts for tabs (call this on init)
   */
  async loadBadgeCounts(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      // Load counts in parallel
      const [favoritedCount, viewedCount] = await Promise.all([
        this.countNewFavoritedMe(currentUser.uid),
        this.countNewViewedMe(currentUser.uid),
      ]);

      this._favoritedMeCount.set(favoritedCount);
      this._viewedMeCount.set(viewedCount);
    } catch (error) {
      console.error('Error loading badge counts:', error);
    }
  }

  /**
   * Load profiles based on the current tab
   * Shows loading state only if no cached data exists for the tab
   */
  async loadProfiles(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    const tab = this._activeTab();
    const cachedProfiles = this._cachedProfiles.get(tab);
    
    // If we have cached data, show it immediately (no loading state)
    // and refresh silently in the background
    if (cachedProfiles && cachedProfiles.length > 0) {
      this._profiles.set(cachedProfiles);
      // Don't show loading, just refresh in background
    } else {
      // No cached data, show loading state
      this._loading.set(true);
      this._profiles.set([]);
    }

    try {
      let profiles: MatchProfile[] = [];

      switch (tab) {
        case 'my-matches':
          profiles = await this.loadMyMatches(currentUser.uid);
          break;
        case 'favorited-me':
          profiles = await this.loadFavoritedMe(currentUser.uid);
          break;
        case 'viewed-me':
          profiles = await this.loadViewedMe(currentUser.uid);
          break;
        case 'my-favorites':
          profiles = await this.loadMyFavorites(currentUser.uid);
          break;
        case 'my-views':
          profiles = await this.loadMyViews(currentUser.uid);
          break;
      }

      // Update cache and current profiles
      this._cachedProfiles.set(tab, profiles);
      this._profiles.set(profiles);
    } catch (error) {
      console.error('Error loading matches:', error);
    } finally {
      this._loading.set(false);
      this._initialized.set(true);
    }
  }

  /**
   * Get the last time the user viewed a specific tab
   */
  private getLastViewedTime(tab: 'favorited-me' | 'viewed-me'): Date {
    if (!isPlatformBrowser(this.platformId)) return new Date(0);
    
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tab}`);
    return stored ? new Date(stored) : new Date(0);
  }

  /**
   * Mark a tab as viewed (store current time)
   */
  private markTabAsViewed(tab: 'favorited-me' | 'viewed-me'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tab}`, new Date().toISOString());
  }

  /**
   * Count new favorites since last viewed
   * Excludes private favorites
   */
  private async countNewFavoritedMe(currentUserId: string): Promise<number> {
    const lastViewed = this.getLastViewedTime('favorited-me');
    
    const favorites = await this.firestoreService.queryCollectionGroup<FavoriteDoc>(
      'favorites',
      [
        this.firestoreService.whereEqual('toUserId', currentUserId),
        this.firestoreService.whereGreaterThan('createdAt', lastViewed),
        this.firestoreService.limitTo(100),
      ]
    );

    // Filter out private favorites client-side (Firestore doesn't support multiple inequality filters on different fields)
    const nonPrivateFavorites = favorites.filter(f => f.private !== true);
    return nonPrivateFavorites.length;
  }

  /**
   * Count new views since last viewed
   */
  private async countNewViewedMe(currentUserId: string): Promise<number> {
    const lastViewed = this.getLastViewedTime('viewed-me');
    
    const views = await this.firestoreService.getCollection<ProfileViewDoc>(
      'profileViews',
      [
        this.firestoreService.whereEqual('viewedUserId', currentUserId),
        this.firestoreService.whereGreaterThan('viewedAt', lastViewed),
        this.firestoreService.limitTo(100),
      ]
    );

    // Deduplicate by viewerId
    const uniqueViewers = new Set(views.map(v => v.viewerId));
    return uniqueViewers.size;
  }

  /**
   * Load users that the current user has matched with (mutual favorites)
   */
  private async loadMyMatches(currentUserId: string): Promise<MatchProfile[]> {
    const matches = await this.firestoreService.getCollection<MatchDoc>(
      'matches',
      [
        this.firestoreService.whereArrayContains('users', currentUserId),
        this.firestoreService.orderByField('createdAt', 'desc'),
        this.firestoreService.limitTo(50),
      ]
    );
    
    // Extract the other user's ID from each match
    const userIds: string[] = [];
    const interactionDates = new Map<string, Date>();
    
    matches.forEach(match => {
      const otherUserId = match.users.find(uid => uid !== currentUserId);
      
      if (otherUserId) {
        userIds.push(otherUserId);
        interactionDates.set(
          otherUserId,
          (match.createdAt as { toDate?: () => Date })?.toDate?.() || new Date()
        );
      }
    });

    return this.loadUserProfiles(userIds, interactionDates);
  }

  /**
   * Load users who have favorited the current user
   * Excludes private favorites (where the user has disabled favorite notifications)
   */
  private async loadFavoritedMe(currentUserId: string): Promise<MatchProfile[]> {
    // Query all users' favorites subcollections for documents where toUserId matches current user
    // This requires a collection group query on 'favorites'
    const favorites = await this.firestoreService.queryCollectionGroup<FavoriteDoc>(
      'favorites',
      [
        this.firestoreService.whereEqual('toUserId', currentUserId),
        this.firestoreService.whereNotEqual('private', true), // Exclude private favorites
        this.firestoreService.orderByField('private', 'asc'), // Required for != query
        this.firestoreService.orderByField('createdAt', 'desc'),
        this.firestoreService.limitTo(50),
      ]
    );

    const userIds = favorites.map(f => f.fromUserId);
    const interactionDates = new Map<string, Date>();
    favorites.forEach(f => {
      interactionDates.set(
        f.fromUserId,
        (f.createdAt as { toDate?: () => Date })?.toDate?.() || new Date()
      );
    });

    return this.loadUserProfiles(userIds, interactionDates);
  }

  /**
   * Load users who have viewed the current user's profile
   */
  private async loadViewedMe(currentUserId: string): Promise<MatchProfile[]> {
    const views = await this.firestoreService.getCollection<ProfileViewDoc>(
      'profileViews',
      [
        this.firestoreService.whereEqual('viewedUserId', currentUserId),
        this.firestoreService.orderByField('viewedAt', 'desc'),
        this.firestoreService.limitTo(50),
      ]
    );

    const userIds = views.map(v => v.viewerId);
    const interactionDates = new Map<string, Date>();
    views.forEach(v => {
      interactionDates.set(
        v.viewerId,
        (v.viewedAt as { toDate?: () => Date })?.toDate?.() || new Date()
      );
    });

    // Deduplicate (same user might view multiple times)
    const uniqueUserIds = [...new Set(userIds)];
    return this.loadUserProfiles(uniqueUserIds, interactionDates);
  }

  /**
   * Load users that the current user has favorited
   */
  private async loadMyFavorites(currentUserId: string): Promise<MatchProfile[]> {
    const favorites = await this.firestoreService.getCollection<FavoriteDoc>(
      `users/${currentUserId}/favorites`,
      [
        this.firestoreService.orderByField('createdAt', 'desc'),
        this.firestoreService.limitTo(50),
      ]
    );

    const interactionDates = new Map<string, Date>();
    const userIds: string[] = [];
    
    favorites.forEach(f => {
      // Support both old format (odTargetUserId) and new format (toUserId)
      const targetUserId = f.toUserId || f.odTargetUserId;
      if (targetUserId) {
        userIds.push(targetUserId);
        interactionDates.set(
          targetUserId,
          (f.createdAt as { toDate?: () => Date })?.toDate?.() || new Date()
        );
      }
    });

    return this.loadUserProfiles(userIds, interactionDates);
  }

  /**
   * Load users that the current user has viewed
   */
  private async loadMyViews(currentUserId: string): Promise<MatchProfile[]> {
    const views = await this.firestoreService.getCollection<ProfileViewDoc>(
      'profileViews',
      [
        this.firestoreService.whereEqual('viewerId', currentUserId),
        this.firestoreService.orderByField('viewedAt', 'desc'),
        this.firestoreService.limitTo(50),
      ]
    );

    const userIds = views.map(v => v.viewedUserId);
    const interactionDates = new Map<string, Date>();
    views.forEach(v => {
      interactionDates.set(
        v.viewedUserId,
        (v.viewedAt as { toDate?: () => Date })?.toDate?.() || new Date()
      );
    });

    // Deduplicate
    const uniqueUserIds = [...new Set(userIds)];
    return this.loadUserProfiles(uniqueUserIds, interactionDates);
  }

  /**
   * Load full user profiles from user IDs
   * Uses batched queries with documentId() to minimize Firestore calls
   * Firestore 'in' operator supports max 30 items, so we batch accordingly
   */
  private async loadUserProfiles(
    userIds: string[],
    interactionDates: Map<string, Date>
  ): Promise<MatchProfile[]> {
    if (userIds.length === 0) return [];

    // Deduplicate user IDs while preserving order
    let uniqueUserIds = [...new Set(userIds)];

    // Filter out blocked users
    const blockedIds = this.blockService.blockedUserIds();
    uniqueUserIds = uniqueUserIds.filter(id => !blockedIds.has(id));
    
    if (uniqueUserIds.length === 0) return [];
    
    // Batch into chunks of 30 (Firestore 'in' limit)
    const BATCH_SIZE = 30;
    const batches: string[][] = [];
    for (let i = 0; i < uniqueUserIds.length; i += BATCH_SIZE) {
      batches.push(uniqueUserIds.slice(i, i + BATCH_SIZE));
    }

    // Execute all batch queries in parallel
    const batchPromises = batches.map(batch => 
      this.firestoreService.getCollection<UserProfile>(
        'users',
        [this.firestoreService.whereIn(this.firestoreService.documentId(), batch)]
      )
    );

    const batchResults = await Promise.all(batchPromises);
    
    // Combine all results into a map for easy lookup
    const userDataMap = new Map<string, UserProfile>();
    for (const users of batchResults) {
      for (const user of users) {
        const userId = (user as unknown as { id: string }).id;
        if (userId) {
          userDataMap.set(userId, user);
        }
      }
    }

    // Build profiles in the original order
    const profiles: MatchProfile[] = [];

    for (const userId of uniqueUserIds) {
      const data = userDataMap.get(userId);
      if (!data) continue;

      // Skip disabled accounts - they should not appear anywhere
      if (data.settings?.account?.disabled === true) continue;

      // Note: We intentionally do NOT filter by profileVisible here.
      // profileVisible only affects discover/search results.
      // Users should still appear in matches, favorites, views, etc.

      // Calculate age
      let age: number | null = null;
      if (data.onboarding?.birthDate) {
        const birth = new Date(data.onboarding.birthDate);
        const today = new Date();
        age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
      }

      // Check online status
      let isOnline = false;
      let lastActiveAt: Date | null = null;
      if (data.lastActiveAt) {
        // Convert Firestore timestamp to Date
        const timestamp = data.lastActiveAt as { toDate?: () => Date };
        lastActiveAt = timestamp?.toDate?.() || null;
        
        // Fallback for non-Timestamp formats
        if (!lastActiveAt && typeof data.lastActiveAt === 'string') {
          lastActiveAt = new Date(data.lastActiveAt);
        }
        
        // Only mark as online if lastActiveAt is valid and within 5 minutes
        if (lastActiveAt && !isNaN(lastActiveAt.getTime())) {
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const showOnlineStatusPref = data.settings?.privacy?.showOnlineStatus !== false;
          isOnline = showOnlineStatusPref && lastActiveAt.getTime() > fiveMinutesAgo.getTime();
        }
      }

      const showOnlineStatus = data.settings?.privacy?.showOnlineStatus !== false;
      const showLastActive = data.settings?.privacy?.showLastActive !== false;
      const showLocation = data.settings?.privacy?.showLocation !== false;

      profiles.push({
        uid: userId,
        displayName: data.displayName || 'Unknown',
        photoURL: data.photoURL || data.onboarding?.photos?.[0] || null,
        photos: data.onboarding?.photos || [],
        age,
        city: showLocation ? (data.onboarding?.city || null) : null,
        country: showLocation ? (data.onboarding?.country || null) : null,
        isVerified: data.isVerified || false,
        isOnline: showOnlineStatus ? isOnline : false,
        showOnlineStatus,
        showLastActive,
        showLocation,
        lastActiveAt: showLastActive ? lastActiveAt : null,
        interactionDate: interactionDates.get(userId) || new Date(),
        connectionTypes: data.onboarding?.connectionTypes || [],
        tagline: data.onboarding?.tagline || '',
      });
    }

    return profiles;
  }
}
