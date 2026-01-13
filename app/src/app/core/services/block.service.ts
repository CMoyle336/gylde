import { Injectable, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
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

@Injectable({
  providedIn: 'root',
})
export class BlockService {
  private readonly functions = inject(Functions);
  private readonly authService = inject(AuthService);

  // Cache of blocked user IDs for filtering
  private readonly _blockedUserIds = signal<Set<string>>(new Set());
  private readonly _loading = signal(false);
  private _initialized = false;

  readonly blockedUserIds = this._blockedUserIds.asReadonly();
  readonly loading = this._loading.asReadonly();

  /**
   * Load all blocked users for the current user
   * Should be called on app init after auth
   */
  async loadBlockedUsers(): Promise<void> {
    const user = this.authService.user();
    if (!user) return;

    if (this._initialized) return; // Only load once

    this._loading.set(true);
    try {
      const getBlockedUsersFn = httpsCallable<void, BlockedUsersResult>(
        this.functions,
        'getBlockedUsers'
      );
      const result = await getBlockedUsersFn();
      this._blockedUserIds.set(new Set(result.data.blockedUserIds));
      this._initialized = true;
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      this._loading.set(false);
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
    this._blockedUserIds.set(new Set());
    this._initialized = false;
  }
}
