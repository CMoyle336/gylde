import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Firestore,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { UserProfile } from '../interfaces';

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
  lastActiveAt: Date | null;
  interactionDate: Date; // When the favorite/view happened
  // Additional fields for profile card
  connectionTypes: string[];
  idealRelationship: string;
  photos: string[];
}

export type MatchTab = 'favorited-me' | 'viewed-me' | 'my-favorites' | 'my-views';

const STORAGE_KEY_PREFIX = 'matches_last_viewed_';

@Injectable({
  providedIn: 'root',
})
export class MatchesService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _loading = signal(false);
  private readonly _activeTab = signal<MatchTab>('favorited-me');
  private readonly _profiles = signal<MatchProfile[]>([]);
  private readonly _favoritedMeCount = signal(0);
  private readonly _viewedMeCount = signal(0);

  readonly loading = this._loading.asReadonly();
  readonly activeTab = this._activeTab.asReadonly();
  readonly profiles = this._profiles.asReadonly();
  readonly favoritedMeCount = this._favoritedMeCount.asReadonly();
  readonly viewedMeCount = this._viewedMeCount.asReadonly();

  readonly isEmpty = computed(() => !this._loading() && this._profiles().length === 0);

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
   */
  async loadProfiles(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    this._loading.set(true);
    this._profiles.set([]);

    try {
      const tab = this._activeTab();
      let profiles: MatchProfile[] = [];

      switch (tab) {
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

      this._profiles.set(profiles);
    } catch (error) {
      console.error('Error loading matches:', error);
    } finally {
      this._loading.set(false);
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
   */
  private async countNewFavoritedMe(currentUserId: string): Promise<number> {
    const lastViewed = this.getLastViewedTime('favorited-me');
    
    const favoritesRef = collectionGroup(this.firestore, 'favorites');
    const q = query(
      favoritesRef,
      where('toUserId', '==', currentUserId),
      where('createdAt', '>', lastViewed),
      limit(100)
    );

    const snapshot = await getDocs(q);
    return snapshot.size;
  }

  /**
   * Count new views since last viewed
   */
  private async countNewViewedMe(currentUserId: string): Promise<number> {
    const lastViewed = this.getLastViewedTime('viewed-me');
    
    const viewsRef = collection(this.firestore, 'profileViews');
    const q = query(
      viewsRef,
      where('viewedUserId', '==', currentUserId),
      where('viewedAt', '>', lastViewed),
      limit(100)
    );

    const snapshot = await getDocs(q);
    // Deduplicate by viewerId
    const uniqueViewers = new Set(snapshot.docs.map(d => d.data()['viewerId']));
    return uniqueViewers.size;
  }

  /**
   * Load users who have favorited the current user
   */
  private async loadFavoritedMe(currentUserId: string): Promise<MatchProfile[]> {
    // Query all users' favorites subcollections for documents where toUserId matches current user
    // This requires a collection group query on 'favorites'
    const favoritesRef = collectionGroup(this.firestore, 'favorites');
    const q = query(
      favoritesRef,
      where('toUserId', '==', currentUserId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    const userIds = snapshot.docs.map(d => d.data()['fromUserId'] as string);
    const interactionDates = new Map<string, Date>();
    snapshot.docs.forEach(d => {
      const data = d.data();
      interactionDates.set(
        data['fromUserId'],
        data['createdAt']?.toDate?.() || new Date()
      );
    });

    return this.loadUserProfiles(userIds, interactionDates);
  }

  /**
   * Load users who have viewed the current user's profile
   */
  private async loadViewedMe(currentUserId: string): Promise<MatchProfile[]> {
    const viewsRef = collection(this.firestore, 'profileViews');
    const q = query(
      viewsRef,
      where('viewedUserId', '==', currentUserId),
      orderBy('viewedAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    const userIds = snapshot.docs.map(d => d.data()['viewerId'] as string);
    const interactionDates = new Map<string, Date>();
    snapshot.docs.forEach(d => {
      const data = d.data();
      interactionDates.set(
        data['viewerId'],
        data['viewedAt']?.toDate?.() || new Date()
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
    const favoritesRef = collection(this.firestore, `users/${currentUserId}/favorites`);
    const q = query(favoritesRef, orderBy('createdAt', 'desc'), limit(50));

    const snapshot = await getDocs(q);
    const userIds = snapshot.docs.map(d => d.data()['toUserId'] as string);
    const interactionDates = new Map<string, Date>();
    snapshot.docs.forEach(d => {
      const data = d.data();
      interactionDates.set(
        data['toUserId'],
        data['createdAt']?.toDate?.() || new Date()
      );
    });

    return this.loadUserProfiles(userIds, interactionDates);
  }

  /**
   * Load users that the current user has viewed
   */
  private async loadMyViews(currentUserId: string): Promise<MatchProfile[]> {
    const viewsRef = collection(this.firestore, 'profileViews');
    const q = query(
      viewsRef,
      where('viewerId', '==', currentUserId),
      orderBy('viewedAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(q);
    const userIds = snapshot.docs.map(d => d.data()['viewedUserId'] as string);
    const interactionDates = new Map<string, Date>();
    snapshot.docs.forEach(d => {
      const data = d.data();
      interactionDates.set(
        data['viewedUserId'],
        data['viewedAt']?.toDate?.() || new Date()
      );
    });

    // Deduplicate
    const uniqueUserIds = [...new Set(userIds)];
    return this.loadUserProfiles(uniqueUserIds, interactionDates);
  }

  /**
   * Load full user profiles from user IDs
   * Uses parallel fetching to avoid N+1 query problem
   */
  private async loadUserProfiles(
    userIds: string[],
    interactionDates: Map<string, Date>
  ): Promise<MatchProfile[]> {
    if (userIds.length === 0) return [];

    // Fetch all user documents in parallel
    const userRefs = userIds.map(userId => doc(this.firestore, 'users', userId));
    const snapshots = await Promise.all(
      userRefs.map(ref => getDoc(ref).catch(() => null))
    );

    const profiles: MatchProfile[] = [];

    for (let i = 0; i < snapshots.length; i++) {
      const userSnap = snapshots[i];
      const userId = userIds[i];

      if (!userSnap?.exists()) continue;

      const data = userSnap.data() as UserProfile;

      // Skip hidden profiles
      if (data.settings?.privacy?.profileVisible === false) continue;

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
        lastActiveAt = (data.lastActiveAt as { toDate?: () => Date })?.toDate?.() 
          || new Date(data.lastActiveAt as string);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        isOnline = data.settings?.privacy?.showOnlineStatus !== false && lastActiveAt > fiveMinutesAgo;
      }

      const showOnlineStatus = data.settings?.privacy?.showOnlineStatus !== false;
      const showLastActive = data.settings?.privacy?.showLastActive !== false;

      profiles.push({
        uid: userId,
        displayName: data.displayName || 'Unknown',
        photoURL: data.photoURL || data.onboarding?.photos?.[0] || null,
        photos: data.onboarding?.photos || [],
        age,
        city: data.onboarding?.city || null,
        country: data.onboarding?.country || null,
        isVerified: data.isVerified || false,
        isOnline: showOnlineStatus ? isOnline : false,
        showOnlineStatus,
        showLastActive,
        lastActiveAt: showLastActive ? lastActiveAt : null,
        interactionDate: interactionDates.get(userId) || new Date(),
        connectionTypes: data.onboarding?.connectionTypes || [],
        idealRelationship: data.onboarding?.idealRelationship || '',
      });
    }

    return profiles;
  }
}
