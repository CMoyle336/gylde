import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

export interface Like {
  fromUserId: string;
  toUserId: string;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root',
})
export class LikeService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);

  // Set of user IDs that the current user has liked
  private readonly _likedUserIds = signal<Set<string>>(new Set());
  readonly likedUserIds = this._likedUserIds.asReadonly();

  /**
   * Load all likes for the current user
   */
  async loadLikes(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const likes = await this.firestoreService.getCollection<Like>(
        `users/${currentUser.uid}/likes`
      );
      
      const likedIds = new Set(likes.map(like => like.toUserId));
      this._likedUserIds.set(likedIds);
    } catch (error) {
      console.error('Failed to load likes:', error);
    }
  }

  /**
   * Check if a user is liked
   */
  isLiked(userId: string): boolean {
    return this._likedUserIds().has(userId);
  }

  /**
   * Like a user profile
   */
  async likeUser(toUserId: string): Promise<boolean> {
    const currentUser = this.authService.user();
    if (!currentUser) return false;

    try {
      const like: Like = {
        fromUserId: currentUser.uid,
        toUserId,
        createdAt: new Date(),
      };

      // Store like in the current user's likes subcollection
      await this.firestoreService.setDocument(
        `users/${currentUser.uid}/likes`,
        toUserId,
        like
      );

      // Update local state
      this._likedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.add(toUserId);
        return newSet;
      });

      // Note: Activity creation and match detection are handled by Firebase Cloud Functions
      // The function triggers on like document creation and handles:
      // - Creating like activity for the recipient
      // - Detecting mutual likes (matches)
      // - Creating match activities for both users

      return true;
    } catch (error) {
      console.error('Failed to like user:', error);
      return false;
    }
  }

  /**
   * Unlike a user profile
   */
  async unlikeUser(toUserId: string): Promise<boolean> {
    const currentUser = this.authService.user();
    if (!currentUser) return false;

    try {
      await this.firestoreService.deleteDocument(
        `users/${currentUser.uid}/likes`,
        toUserId
      );

      // Update local state
      this._likedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.delete(toUserId);
        return newSet;
      });

      return true;
    } catch (error) {
      console.error('Failed to unlike user:', error);
      return false;
    }
  }

  /**
   * Toggle like state for a user
   */
  async toggleLike(userId: string): Promise<boolean> {
    if (this.isLiked(userId)) {
      return this.unlikeUser(userId);
    } else {
      return this.likeUser(userId);
    }
  }
}
