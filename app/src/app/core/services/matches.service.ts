import { Injectable, inject, signal, computed } from '@angular/core';
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

@Injectable({
  providedIn: 'root',
})
export class MatchesService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private readonly _loading = signal(false);
  private readonly _activeTab = signal<MatchTab>('favorited-me');
  private readonly _profiles = signal<MatchProfile[]>([]);

  readonly loading = this._loading.asReadonly();
  readonly activeTab = this._activeTab.asReadonly();
  readonly profiles = this._profiles.asReadonly();

  readonly isEmpty = computed(() => !this._loading() && this._profiles().length === 0);

  /**
   * Set the active tab and load profiles for that tab
   */
  async setTab(tab: MatchTab): Promise<void> {
    this._activeTab.set(tab);
    await this.loadProfiles();
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
   */
  private async loadUserProfiles(
    userIds: string[],
    interactionDates: Map<string, Date>
  ): Promise<MatchProfile[]> {
    if (userIds.length === 0) return [];

    const profiles: MatchProfile[] = [];

    // Load each user's profile
    for (const userId of userIds) {
      try {
        const userRef = doc(this.firestore, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) continue;

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
          photoURL: data.onboarding?.photos?.[0] || data.photoURL || null,
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
      } catch (error) {
        console.error(`Error loading profile ${userId}:`, error);
      }
    }

    return profiles;
  }
}
