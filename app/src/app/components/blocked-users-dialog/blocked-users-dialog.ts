import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BlockService } from '../../core/services/block.service';
import { UserProfileService } from '../../core/services/user-profile.service';

interface BlockedUserDisplay {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

@Component({
  selector: 'app-blocked-users-dialog',
  templateUrl: './blocked-users-dialog.html',
  styleUrl: './blocked-users-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class BlockedUsersDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<BlockedUsersDialogComponent>);
  private readonly functions = inject(Functions);
  private readonly blockService = inject(BlockService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly blockedUsers = signal<BlockedUserDisplay[]>([]);
  protected readonly loading = signal(true);
  protected readonly unblockingUserId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadBlockedUsers();
  }

  private async loadBlockedUsers(): Promise<void> {
    this.loading.set(true);
    try {
      const getBlockedUsersFn = httpsCallable<void, { blockedByMe: string[] }>(
        this.functions,
        'getBlockedUsers'
      );
      const result = await getBlockedUsersFn();
      const blockedIds = result.data.blockedByMe;

      if (blockedIds.length === 0) {
        this.blockedUsers.set([]);
        return;
      }

      // Fetch user details for each blocked user
      const users: BlockedUserDisplay[] = [];
      for (const uid of blockedIds) {
        const profile = await this.userProfileService.loadUserProfile(uid);
        if (profile) {
          users.push({
            uid,
            displayName: profile.displayName || 'Unknown User',
            photoURL: profile.photoURL || null,
          });
        }
      }
      this.blockedUsers.set(users);
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      this.loading.set(false);
    }
  }

  protected async unblockUser(userId: string): Promise<void> {
    this.unblockingUserId.set(userId);
    try {
      await this.blockService.unblockUser(userId);
      // Remove from local list
      this.blockedUsers.update(users => users.filter(u => u.uid !== userId));
    } catch (error) {
      console.error('Error unblocking user:', error);
    } finally {
      this.unblockingUserId.set(null);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
