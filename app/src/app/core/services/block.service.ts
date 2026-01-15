import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Unsubscribe } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

export interface BlockStatus {
  isBlocked: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
}

export interface BlockedUsersResult {
  blockedUserIds: string[];
  blockedByMe: string[];
  blockedMe: string[];
}

interface BlockDoc {
  id?: string;
  blockedAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class BlockService {
  private readonly functions = inject(Functions);
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);

  // Cache of blocked user IDs for filtering
  private readonly _blockedUserIds = signal<Set<string>>(new Set());
  private readonly _blockedByMe = signal<Set<string>>(new Set());
  private readonly _blockedMe = signal<Set<string>>(new Set());
  private readonly _loading = signal(false);
  private _initialized = false;

  // Real-time subscription handles
  private blocksUnsubscribe: Unsubscribe | null = null;
  private blockedByUnsubscribe: Unsubscribe | null = null;

  readonly blockedUserIds = this._blockedUserIds.asReadonly();
  readonly blockedByMe = this._blockedByMe.asReadonly();
  readonly blockedMe = this._blockedMe.asReadonly();
  readonly loading = this._loading.asReadonly();

  /**
   * Load all blocked users for the current user and set up real-time subscriptions
   * Should be called on app init after auth
   */
  async loadBlockedUsers(): Promise<void> {
    const user = this.authService.user();
    if (!user) return;

    if (this._initialized) return; // Only load once

    this._loading.set(true);
    try {
      // Initial load via Cloud Function
      const getBlockedUsersFn = httpsCallable<void, BlockedUsersResult>(
        this.functions,
        'getBlockedUsers'
      );
      const result = await getBlockedUsersFn();
      this._blockedByMe.set(new Set(result.data.blockedByMe));
      this._blockedMe.set(new Set(result.data.blockedMe));
      this._blockedUserIds.set(new Set(result.data.blockedUserIds));
      
      // Set up real-time subscriptions for immediate updates
      this.setupRealtimeSubscriptions(user.uid);
      
      this._initialized = true;
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Set up real-time subscriptions for block changes
   */
  private setupRealtimeSubscriptions(userId: string): void {
    // Clean up any existing subscriptions
    this.cleanupSubscriptions();

    // Subscribe to users I've blocked (users/{me}/blocks)
    this.blocksUnsubscribe = this.firestoreService.subscribeToCollection<BlockDoc>(
      `users/${userId}/blocks`,
      [],
      (blocks) => {
        const blockedByMe = new Set<string>();
        blocks.forEach(block => {
          if (block.id) blockedByMe.add(block.id);
        });
        this._blockedByMe.set(blockedByMe);
        this.updateCombinedBlockedUsers();
      }
    );

    // Subscribe to users who blocked me (users/{me}/blockedBy)
    this.blockedByUnsubscribe = this.firestoreService.subscribeToCollection<BlockDoc>(
      `users/${userId}/blockedBy`,
      [],
      (blockedBy) => {
        const blockedMe = new Set<string>();
        blockedBy.forEach(block => {
          if (block.id) blockedMe.add(block.id);
        });
        this._blockedMe.set(blockedMe);
        this.updateCombinedBlockedUsers();
      }
    );
  }

  /**
   * Update the combined set of all blocked users (bidirectional)
   */
  private updateCombinedBlockedUsers(): void {
    const combined = new Set([...this._blockedByMe(), ...this._blockedMe()]);
    this._blockedUserIds.set(combined);
  }

  /**
   * Clean up real-time subscriptions
   */
  private cleanupSubscriptions(): void {
    if (this.blocksUnsubscribe) {
      this.blocksUnsubscribe();
      this.blocksUnsubscribe = null;
    }
    if (this.blockedByUnsubscribe) {
      this.blockedByUnsubscribe();
      this.blockedByUnsubscribe = null;
    }
  }

  /**
   * Check if a specific user is blocked (cached)
   */
  isUserBlocked(userId: string): boolean {
    return this._blockedUserIds().has(userId);
  }

  /**
   * Check block status for a specific user (real-time from server)
   */
  async checkBlockStatus(userId: string): Promise<BlockStatus> {
    try {
      const checkBlockStatusFn = httpsCallable<{ userId: string }, BlockStatus>(
        this.functions,
        'checkBlockStatus'
      );
      const result = await checkBlockStatusFn({ userId });
      return result.data;
    } catch (error) {
      console.error('Error checking block status:', error);
      return { isBlocked: false, blockedByMe: false, blockedMe: false };
    }
  }

  /**
   * Block a user
   */
  async blockUser(userId: string): Promise<boolean> {
    try {
      const blockUserFn = httpsCallable<{ userId: string }, { success: boolean }>(
        this.functions,
        'blockUser'
      );
      await blockUserFn({ userId });

      // Update local cache
      this._blockedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.add(userId);
        return newSet;
      });

      return true;
    } catch (error) {
      console.error('Error blocking user:', error);
      return false;
    }
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string): Promise<boolean> {
    try {
      const unblockUserFn = httpsCallable<{ userId: string }, { success: boolean }>(
        this.functions,
        'unblockUser'
      );
      await unblockUserFn({ userId });

      // Update local cache
      this._blockedUserIds.update(set => {
        const newSet = new Set(set);
        newSet.delete(userId);
        return newSet;
      });

      return true;
    } catch (error) {
      console.error('Error unblocking user:', error);
      return false;
    }
  }

  /**
   * Filter an array of user IDs to remove blocked users
   */
  filterBlockedUsers<T extends { uid: string }>(users: T[]): T[] {
    const blocked = this._blockedUserIds();
    return users.filter(u => !blocked.has(u.uid));
  }

  /**
   * Reset the service (call on logout)
   */
  reset(): void {
    this.cleanupSubscriptions();
    this._blockedUserIds.set(new Set());
    this._blockedByMe.set(new Set());
    this._blockedMe.set(new Set());
    this._initialized = false;
  }
}
