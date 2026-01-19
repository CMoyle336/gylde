import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { ReportDialogComponent, ReportDialogData } from '../../components/report-dialog';
import { BlockConfirmDialogComponent, BlockConfirmDialogData } from '../../components/block-confirm-dialog';
import { UserProfile, ReputationTier, shouldShowPublicBadge, getTierDisplay } from '../../core/interfaces';
import { Photo, PhotoAccessSummary } from '../../core/interfaces/photo.interface';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { AuthService } from '../../core/services/auth.service';
import { ActivityService } from '../../core/services/activity.service';
import { PhotoAccessService } from '../../core/services/photo-access.service';
import { BlockService, BlockStatus } from '../../core/services/block.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { ProfileSkeletonComponent } from './components';
import { ReputationBadgeComponent } from '../../components/reputation-badge';
import { formatConnectionTypes as formatConnectionTypesUtil, getSupportOrientationLabel } from '../../core/constants/connection-types';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    ProfileSkeletonComponent,
    ReputationBadgeComponent,
  ],
})
export class UserProfileComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);
  private readonly authService = inject(AuthService);
  private readonly activityService = inject(ActivityService);
  private readonly photoAccessService = inject(PhotoAccessService);
  private readonly blockService = inject(BlockService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);

  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedPhotoIndex = signal(0);
  protected readonly lastViewedMe = signal<Date | null>(null);

  // Photo access state
  protected readonly photoAccess = signal<PhotoAccessSummary>({ hasAccess: false });
  protected readonly requestingAccess = signal(false);
  protected readonly photoPrivacyMap = signal<Map<string, boolean>>(new Map());

  // Block state
  protected readonly blockStatus = signal<BlockStatus>({ isBlocked: false, blockedByMe: false, blockedMe: false });
  protected readonly blockingUser = signal(false);

  // Real-time subscription cleanup
  private accessStatusUnsubscribe?: () => void;

  private readonly favoritedUserIds = this.favoriteService.favoritedUserIds;
  
  protected readonly isFavorited = computed(() => {
    const p = this.profile();
    return p ? this.favoritedUserIds().has(p.uid) : false;
  });

  // Reputation badge - only shown for active tier and above
  protected readonly showReputationBadge = computed(() => {
    const tier = this.profile()?.reputationTier;
    return tier ? shouldShowPublicBadge(tier) : false;
  });

  protected readonly reputationTier = computed((): ReputationTier => {
    return this.profile()?.reputationTier ?? 'new';
  });

  protected readonly reputationDisplay = computed(() => {
    return getTierDisplay(this.reputationTier());
  });

  // Has private photos that viewer can't see
  protected readonly hasHiddenPrivatePhotos = computed(() => {
    const privacyMap = this.photoPrivacyMap();
    const access = this.photoAccess();
    if (access.hasAccess) return false;
    return Array.from(privacyMap.values()).some(isPrivate => isPrivate);
  });

  // Count of private photos
  protected readonly privatePhotoCount = computed(() => {
    const privacyMap = this.photoPrivacyMap();
    return Array.from(privacyMap.values()).filter(isPrivate => isPrivate).length;
  });

  // Get photos in display order from photoDetails
  // Also filter out private photos if user doesn't have access
  protected readonly orderedPhotos = computed(() => {
    const p = this.profile();
    const photoDetails = p?.onboarding?.photoDetails || [];
    const photoURL = p?.photoURL;
    const access = this.photoAccess();
    
    // Sort by order field
    const sortedDetails = [...photoDetails].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    
    // Filter out private photos if no access
    let visibleDetails = sortedDetails;
    if (!access.hasAccess) {
      visibleDetails = sortedDetails.filter(detail => !detail.isPrivate);
    }
    
    // Extract URLs
    const photos = visibleDetails.map(d => d.url);
    
    if (!photoURL || photos.length === 0) return photos;
    
    // If photoURL is already first, no reordering needed
    if (photos[0] === photoURL) return photos;
    
    // Find the index of photoURL in the array
    const photoURLIndex = photos.indexOf(photoURL);
    if (photoURLIndex === -1) {
      // photoURL not in array, prepend it (profile photo is always visible)
      return [photoURL, ...photos];
    }
    
    // Move photoURL to the front
    const reordered = [...photos];
    reordered.splice(photoURLIndex, 1);
    reordered.unshift(photoURL);
    return reordered;
  });

  protected readonly profilePhoto = computed(() => {
    const photos = this.orderedPhotos();
    if (!photos.length) return this.profile()?.photoURL || null;
    return photos[this.selectedPhotoIndex()] || photos[0];
  });

  protected readonly age = computed(() => {
    const birthDate = this.profile()?.onboarding?.birthDate;
    if (!birthDate) return null;
    return this.calculateAge(birthDate);
  });

  ngOnInit(): void {
    // Subscribe to route param changes to handle navigation between different user profiles
    this.route.paramMap
      .pipe(
        map(params => params.get('userId')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(userId => {
        if (userId) {
          // Reset state when navigating to a different profile
          this.selectedPhotoIndex.set(0);
          this.profile.set(null);
          this.photoAccess.set({ hasAccess: false });
          this.photoPrivacyMap.set(new Map());
          this.lastViewedMe.set(null);
          this.error.set(null);
          
          this.loadProfile(userId);
        } else {
          this.error.set('User not found');
          this.loading.set(false);
        }
      });
  }

  ngOnDestroy(): void {
    // Cleanup real-time subscription
    this.accessStatusUnsubscribe?.();
  }

  private async loadProfile(userId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set(null);

      // Start all independent fetches in parallel for faster page load:
      // - Block status check
      // - User profile document
      // - Photo access status subscription
      // - Last viewed by (when did this user view me?)
      // - Record profile view (fire and forget)
      
      const userRef = doc(this.firestore, 'users', userId);
      
      // Set up photo access subscription immediately (doesn't need profile data)
      this.accessStatusUnsubscribe?.();
      this.accessStatusUnsubscribe = this.photoAccessService.subscribeToAccessStatus(
        userId,
        (status) => {
          this.photoAccess.set(status);
        }
      );
      
      // Start lastViewedBy fetch in parallel (doesn't need profile data)
      const lastViewedPromise = this.activityService.getLastViewedBy(userId);
      
      // Record view in background immediately (doesn't need profile data)
      this.activityService.recordProfileView(userId).catch(err => {
        console.error('Error recording profile view:', err);
      });
      
      // Fetch block status and profile in parallel
      const [blockStatus, userSnap] = await Promise.all([
        this.blockService.checkBlockStatus(userId),
        getDoc(userRef),
      ]);

      this.blockStatus.set(blockStatus);
      
      if (blockStatus.isBlocked) {
        this.error.set('This profile is not available');
        this.loading.set(false);
        return;
      }

      if (!userSnap.exists()) {
        this.error.set('User not found');
        this.loading.set(false);
        return;
      }

      const userData = userSnap.data() as UserProfile;
      
      // Check if account is disabled - disabled accounts should not be viewable
      if (userData.settings?.account?.disabled === true) {
        this.error.set('This profile is not available');
        this.loading.set(false);
        return;
      }

      // Note: We do NOT check profileVisible here.
      // profileVisible only affects discover/search results.
      // Users can still view profiles they have direct links to
      // (e.g., from matches, favorites, messages, activity).

      this.profile.set(userData);

      // Load photo privacy info
      const photoDetails = userData.onboarding?.photoDetails || [];
      const privacyMap = new Map<string, boolean>();
      for (const detail of photoDetails as Photo[]) {
        privacyMap.set(detail.url, detail.isPrivate);
      }
      this.photoPrivacyMap.set(privacyMap);

      // Wait for lastViewedBy since we display it (already started above)
      const lastViewed = await lastViewedPromise;
      this.lastViewedMe.set(lastViewed);
    } catch (err) {
      console.error('Error loading profile:', err);
      this.error.set('Failed to load profile');
    } finally {
      this.loading.set(false);
    }
  }

  protected goBack(): void {
    this.router.navigate(['/discover']);
  }

  protected selectPhoto(index: number): void {
    this.selectedPhotoIndex.set(index);
  }

  protected prevPhoto(): void {
    const photos = this.orderedPhotos();
    const current = this.selectedPhotoIndex();
    this.selectedPhotoIndex.set(current > 0 ? current - 1 : photos.length - 1);
  }

  protected nextPhoto(): void {
    const photos = this.orderedPhotos();
    const current = this.selectedPhotoIndex();
    this.selectedPhotoIndex.set(current < photos.length - 1 ? current + 1 : 0);
  }

  protected async onMessage(): Promise<void> {
    const p = this.profile();
    if (!p) return;

    const conversationId = await this.messageService.startConversation(p.uid);

    if (conversationId) {
      this.messageService.openConversation({
        id: conversationId,
        otherUser: {
          uid: p.uid,
          displayName: p.displayName || 'Unknown',
          photoURL: p.photoURL,
          reputationTier: p.reputationTier,
        },
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
        isArchived: false,
      });
      this.router.navigate(['/messages', conversationId]);
    }
  }

  protected async onFavorite(): Promise<void> {
    const p = this.profile();
    if (!p) return;
    await this.favoriteService.toggleFavorite(p.uid);
  }

  protected onReport(): void {
    const p = this.profile();
    if (!p) return;

    this.dialog.open<ReportDialogComponent, ReportDialogData>(ReportDialogComponent, {
      data: {
        userId: p.uid,
        displayName: p.displayName || 'This user',
      },
      width: '500px',
      maxWidth: '95vw',
    });
  }

  protected async requestPhotoAccess(): Promise<void> {
    const p = this.profile();
    if (!p) return;

    // Check if user has subscription capability to request private photos
    if (!this.subscriptionService.canPerformAction('canAccessPrivatePhotos', true)) {
      return; // Upgrade dialog is shown automatically
    }

    this.requestingAccess.set(true);
    try {
      await this.photoAccessService.requestAccess(p.uid);
      this.photoAccess.set({ hasAccess: false, requestStatus: 'pending' });
    } catch (error) {
      console.error('Error requesting photo access:', error);
    } finally {
      this.requestingAccess.set(false);
    }
  }

  protected async cancelPhotoAccessRequest(): Promise<void> {
    const p = this.profile();
    if (!p) return;

    this.requestingAccess.set(true);
    try {
      await this.photoAccessService.cancelRequest(p.uid);
      this.photoAccess.set({ hasAccess: false, requestStatus: undefined });
    } catch (error) {
      console.error('Error cancelling photo access request:', error);
    } finally {
      this.requestingAccess.set(false);
    }
  }

  protected getAccessStatusText(): string {
    const access = this.photoAccess();
    if (access.hasAccess) return '';
    if (access.requestStatus === 'pending') return 'Request pending';
    if (access.requestStatus === 'denied') return 'Request denied';
    return '';
  }

  protected isPhotoPrivate(photoUrl: string): boolean {
    return this.photoPrivacyMap().get(photoUrl) || false;
  }

  protected isCurrentPhotoPrivate(): boolean {
    const currentPhoto = this.profilePhoto();
    if (!currentPhoto) return false;
    return this.isPhotoPrivate(currentPhoto);
  }

  private calculateAge(birthDate: string): number {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  protected formatGender(gender: string | undefined): string {
    const labels: Record<string, string> = {
      'woman': 'Woman',
      'man': 'Man',
      'nonbinary': 'Non-binary',
      'self-describe': 'Other',
    };
    return gender ? labels[gender] || gender : '';
  }

  protected formatConnectionTypes(types: string[] | undefined): string {
    return formatConnectionTypesUtil(types);
  }

  protected formatSupportOrientation(value: string | undefined): string {
    return getSupportOrientationLabel(value);
  }

  protected isOnline(): boolean {
    const p = this.profile();
    // Default to showing online status unless explicitly disabled
    if (p?.settings?.privacy?.showOnlineStatus === false) return false;
    if (!p?.lastActiveAt) return false;
    
    const timestamp = p.lastActiveAt as { toDate?: () => Date };
    const lastActive = timestamp?.toDate?.() || null;
    if (!lastActive) return false;
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return lastActive.getTime() > fiveMinutesAgo.getTime();
  }

  protected getLastActive(): string {
    const p = this.profile();
    // Default to showing last active unless explicitly disabled
    if (p?.settings?.privacy?.showLastActive === false) return '';
    if (!p?.lastActiveAt) return '';
    
    const timestamp = p.lastActiveAt as { toDate?: () => Date };
    const lastActive = timestamp?.toDate?.() || null;
    if (!lastActive) return '';
    const now = new Date();
    const diff = now.getTime() - lastActive.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  protected formatLastViewedMe(): string {
    const date = this.lastViewedMe();
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return date.toLocaleDateString();
  }

  protected formatProfileAge(): string {
    const p = this.profile();
    if (!p?.createdAt) return 'Unknown';
    
    const createdAt = (p.createdAt as { toDate?: () => Date })?.toDate?.() 
      || new Date(p.createdAt as string);
    
    const now = new Date();
    const diff = now.getTime() - createdAt.getTime();
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (days < 1) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  // Block user functionality
  protected openBlockDialog(): void {
    const p = this.profile();
    if (!p) return;

    const dialogRef = this.dialog.open<BlockConfirmDialogComponent, BlockConfirmDialogData, boolean>(
      BlockConfirmDialogComponent,
      {
        data: {
          userId: p.uid,
          displayName: p.displayName || 'This user',
        },
        width: '450px',
        maxWidth: '95vw',
      }
    );

    dialogRef.afterClosed().subscribe((blocked) => {
      if (blocked) {
        // Navigate away since they can no longer see this profile
        this.router.navigate(['/discover']);
      }
    });
  }

  protected async unblockUser(): Promise<void> {
    const p = this.profile();
    if (!p) return;

    this.blockingUser.set(true);
    try {
      await this.blockService.unblockUser(p.uid);
      this.blockStatus.set({ isBlocked: false, blockedByMe: false, blockedMe: false });
    } catch (error) {
      console.error('Error unblocking user:', error);
    } finally {
      this.blockingUser.set(false);
    }
  }
}
