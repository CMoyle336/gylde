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

      // Check for mutual like (match)
      const isMutual = await this.checkMutualLike(toUserId, currentUser.uid);
      if (isMutual) {
        await this.createMatch(currentUser.uid, toUserId);
      }

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

  /**
   * Check if the other user has also liked the current user (mutual like = match)
   */
  private async checkMutualLike(otherUserId: string, currentUserId: string): Promise<boolean> {
    try {
      const otherUserLike = await this.firestoreService.getDocument<Like>(
        `users/${otherUserId}/likes`,
        currentUserId
      );
      return otherUserLike !== null;
    } catch {
      return false;
    }
  }

  /**
   * Create a match when both users have liked each other
   */
  private async createMatch(userId1: string, userId2: string): Promise<void> {
    const matchId = [userId1, userId2].sort().join('_');
    
    const match = {
      users: [userId1, userId2],
      createdAt: new Date(),
    };

    try {
      await this.firestoreService.setDocument('matches', matchId, match);
      console.log('Match created!', matchId);
      // TODO: Send notification to both users
    } catch (error) {
      console.error('Failed to create match:', error);
    }
  }
}
