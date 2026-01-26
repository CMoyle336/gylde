
import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DiscoveryService } from '../../core/services/discovery.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { DiscoverableProfile, DiscoveryFilters, DiscoverySort, SavedView } from '../../core/interfaces';
import { ProfileCardComponent, ProfileCardData } from '../../components/profile-card';
import { ProfileCardSkeletonComponent } from '../../components/profile-card-skeleton';
import {
  DiscoverFiltersComponent,
  SaveViewDialogComponent,
  ManageViewsDialogComponent,
} from './components';

@Component({
  selector: 'app-discover',
  templateUrl: './discover.html',
  styleUrl: './discover.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
    TranslateModule,
    ProfileCardComponent,
    ProfileCardSkeletonComponent,
    DiscoverFiltersComponent,
    SaveViewDialogComponent,
    ManageViewsDialogComponent,
  ],
})
export class DiscoverComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly discoveryService = inject(DiscoveryService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly analytics = inject(AnalyticsService);
  private readonly translate = inject(TranslateService);

  // UI state
  protected readonly showFilters = signal(false);
  protected readonly showSaveViewDialog = signal(false);
  protected readonly showManageViewsDialog = signal(false);
  protected readonly messagingUserId = signal<string | null>(null); // Track which user is being messaged

  // Discovery state from service
  protected readonly profiles = this.discoveryService.profiles;
  protected readonly loading = this.discoveryService.loading;
  protected readonly initialized = this.discoveryService.initialized;
  protected readonly filters = this.discoveryService.filters;
  protected readonly sort = this.discoveryService.sort;
  protected readonly savedViews = this.discoveryService.savedViews;
  protected readonly activeView = this.discoveryService.activeView;
  protected readonly hasMore = this.discoveryService.hasMore;
  protected readonly totalEstimate = this.discoveryService.totalEstimate;
  protected readonly activeFilterCount = this.discoveryService.activeFilterCount;

  // Filter options from service
  protected readonly connectionTypeOptions = this.discoveryService.connectionTypeOptions;
  protected readonly ethnicityOptions = this.discoveryService.ethnicityOptions;
  protected readonly relationshipStatusOptions = this.discoveryService.relationshipStatusOptions;
  protected readonly childrenOptions = this.discoveryService.childrenOptions;
  protected readonly smokerOptions = this.discoveryService.smokerOptions;
  protected readonly drinkerOptions = this.discoveryService.drinkerOptions;
  protected readonly educationOptions = this.discoveryService.educationOptions;
  protected readonly heightOptions = this.discoveryService.heightOptions;
  protected readonly incomeOptions = this.discoveryService.incomeOptions;
  protected readonly supportOrientationOptions = this.discoveryService.supportOrientationOptions;
  protected readonly distanceOptions = this.discoveryService.distanceOptions;
  protected readonly sortOptions = this.discoveryService.sortOptions;
  protected readonly reputationTierOptions = this.discoveryService.reputationTierOptions;

  protected readonly favoritedUserIds = this.favoriteService.favoritedUserIds;

  // Skeleton count for loading state
  protected readonly skeletonCards = Array.from({ length: 12 }, (_, i) => i);

  ngOnInit(): void {
    this.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    await this.discoveryService.loadSavedViews();
    await this.discoveryService.searchProfiles();
  }

  // UI Toggles
  protected toggleFilters(): void {
    this.showFilters.update(v => !v);
  }

  protected async refresh(): Promise<void> {
    await this.discoveryService.searchProfiles(false, true); // force refresh
  }

  // Filter management
  protected onFilterChange(event: { key: keyof DiscoveryFilters; value: unknown }): void {
    this.discoveryService.updateFilters({ [event.key]: event.value } as Partial<DiscoveryFilters>);
  }

  protected resetFilters(): void {
    this.discoveryService.resetFilters();
  }

  protected async applyFilters(): Promise<void> {
    this.showFilters.set(false);
    await this.discoveryService.searchProfiles(false, true); // Force refresh to show loading
    
    // Track search with filters
    this.analytics.trackDiscoverySearch({
      filterCount: this.activeFilterCount(),
      sortField: this.sort().field,
      sortDirection: this.sort().direction,
      resultCount: this.profiles().length,
    });
  }

  // Sort management
  protected setSort(sort: DiscoverySort): void {
    this.analytics.trackSortChanged(sort.field, sort.direction);
    this.discoveryService.updateSort(sort);
    this.discoveryService.searchProfiles(false, true); // Force refresh to show loading
  }

  protected getSortLabel(): string {
    const currentSort = this.sort();
    const option = this.sortOptions.find(
      o => o.value.field === currentSort.field && o.value.direction === currentSort.direction
    );
    return option?.label || this.translate.instant('DISCOVER.SORT_LABEL');
  }

  protected isSortActive(sort: DiscoverySort): boolean {
    const currentSort = this.sort();
    return currentSort.field === sort.field && currentSort.direction === sort.direction;
  }

  // View management
  protected applyView(view: SavedView): void {
    this.analytics.trackSavedViewApplied(view.name);
    this.discoveryService.applyView(view);
    this.discoveryService.searchProfiles(false, true); // Force refresh to show loading
  }

  protected openSaveViewDialog(): void {
    this.showSaveViewDialog.set(true);
  }

  protected closeSaveViewDialog(): void {
    this.showSaveViewDialog.set(false);
  }

  protected async onSaveView(event: { name: string; isDefault: boolean }): Promise<void> {
    await this.discoveryService.saveView(event.name, event.isDefault);
    this.analytics.trackSavedViewCreated(event.name, event.isDefault);
    this.closeSaveViewDialog();
  }

  protected openManageViewsDialog(): void {
    this.showManageViewsDialog.set(true);
  }

  protected closeManageViewsDialog(): void {
    this.showManageViewsDialog.set(false);
  }

  protected async deleteView(viewId: string): Promise<void> {
    await this.discoveryService.deleteView(viewId);
  }

  protected async setDefaultView(viewId: string): Promise<void> {
    await this.discoveryService.setDefaultView(viewId);
  }

  // Pagination
  private pageNumber = 1;
  protected async loadMore(): Promise<void> {
    this.pageNumber++;
    this.analytics.trackLoadMore(this.pageNumber);
    await this.discoveryService.loadMore();
  }

  // Profile actions
  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
  }

  protected onViewProfile(profile: ProfileCardData): void {
    this.analytics.trackProfileView(profile.uid, 'discover');
    this.router.navigate(['/user', profile.uid]);
  }

  protected async onFavoriteProfile(profile: ProfileCardData): Promise<void> {
    const wasFavorited = this.isFavorited(profile.uid);
    await this.favoriteService.toggleFavorite(profile.uid);
    
    if (wasFavorited) {
      this.analytics.trackFavoriteRemoved('discover');
    } else {
      this.analytics.trackFavoriteAdded('discover');
    }
  }

  protected async onMessageProfile(profile: ProfileCardData): Promise<void> {
    this.messagingUserId.set(profile.uid);
    
    try {
      // Check if we can start a conversation before creating the conversation document
      const permission = await this.messageService.canStartConversation(profile.uid);
      
      if (!permission.allowed) {
        if (permission.reason === 'recipient_min_tier_not_met') {
          const tierLabel = permission.recipientMinTierLabel || 'a higher';
          this.snackBar.open(
            `This member accepts messages from ${tierLabel} reputation and above.`,
            'OK',
            { duration: 5000, panelClass: 'info-snackbar' }
          );
        } else if (permission.reason === 'higher_tier_limit_reached') {
          const tierDisplay = permission.recipientTier 
            ? permission.recipientTier.charAt(0).toUpperCase() + permission.recipientTier.slice(1)
            : 'higher tier';
          this.snackBar.open(
            `You've reached your daily limit for starting conversations with ${tierDisplay} members. Try again tomorrow or upgrade your reputation.`,
            'OK',
            { duration: 6000, panelClass: 'error-snackbar' }
          );
        } else if (permission.reason === 'blocked') {
          this.snackBar.open(
            'You cannot message this user.',
            'OK',
            { duration: 4000, panelClass: 'error-snackbar' }
          );
        }
        return;
      }

      const photoURL = profile.photos?.[0] || profile.photoURL || null;
      const conversationId = await this.messageService.startConversation(profile.uid);
      
      if (conversationId) {
        this.analytics.trackConversationStarted('discover');
        
        this.messageService.openConversation({
          id: conversationId,
          otherUser: {
            uid: profile.uid,
            displayName: profile.displayName || 'Unknown',
            photoURL,
            reputationTier: profile.reputationTier,
          },
          lastMessage: null,
          lastMessageTime: null,
          unreadCount: 0,
          isArchived: false,
        });
        
        this.router.navigate(['/messages', conversationId]);
      }
    } finally {
      this.messagingUserId.set(null);
    }
  }

  protected isMessagingUser(uid: string): boolean {
    return this.messagingUserId() === uid;
  }
}
