import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

export interface Favorite {
  fromUserId: string;
  toUserId: string;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root',
})
export class FavoriteService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);

  // Set of user IDs that the current user has favorited
  private readonly _favoritedUserIds = signal<Set<string>>(new Set());
  readonly favoritedUserIds = this._favoritedUserIds.asReadonly();

  /**
   * Load all favorites for the current user
   */
  async loadFavorites(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const favorites = await this.firestoreService.getCollection<Favorite>(
        `users/${currentUser.uid}/favorites`
      );
      
      const favoritedIds = new Set(favorites.map(fav => fav.toUserId));
      this._favoritedUserIds.set(favoritedIds);
    } catch (error) {
      console.error('Failed to load favorites:', error);
    }
  }

  /**
   * Check if a user is favorited
   */
  isFavorited(userId: string): boolean {
    return this._favoritedUserIds().has(userId);
  }

  /**
   * Favorite a user profile
   */
  async favoriteUser(toUserId: string): Promise<boolean> {
    const currentUser = this.authService.user();
    if (!currentUser) return false;

    try {
      const favorite: Favorite = {
        fromUserId: currentUser.uid,
        toUserId,
        createdAt: new Date(),
      };

      // Store favorite in the current user's favorites subcollection
      await this.firestoreService.setDocument(
        `users/${currentUser.uid}/favorites`,
        toUserId,
        favorite
      );

      // Update local state
      this._favoritedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.add(toUserId);
        return newSet;
      });

      // Note: Activity creation and match detection are handled by Firebase Cloud Functions
      // The function triggers on favorite document creation and handles:
      // - Creating favorite activity for the recipient
      // - Detecting mutual favorites (matches)
      // - Creating match activities for both users

      return true;
    } catch (error) {
      console.error('Failed to favorite user:', error);
      return false;
    }
  }

  /**
   * Unfavorite a user profile
   */
  async unfavoriteUser(toUserId: string): Promise<boolean> {
    const currentUser = this.authService.user();
    if (!currentUser) return false;

    try {
      await this.firestoreService.deleteDocument(
        `users/${currentUser.uid}/favorites`,
        toUserId
      );

      // Update local state
      this._favoritedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.delete(toUserId);
        return newSet;
      });

      return true;
    } catch (error) {
      console.error('Failed to unfavorite user:', error);
      return false;
    }
  }

  /**
   * Toggle favorite state for a user
   */
  async toggleFavorite(userId: string): Promise<boolean> {
    if (this.isFavorited(userId)) {
      return this.unfavoriteUser(userId);
    } else {
      return this.favoriteUser(userId);
    }
  }
}
