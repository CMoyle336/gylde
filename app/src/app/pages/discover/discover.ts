
import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { DiscoveryService } from '../../core/services/discovery.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { DiscoverableProfile, DiscoveryFilters, DiscoverySort, SavedView } from '../../core/interfaces';
import {
  ProfileCardComponent,
  ProfileCardSkeletonComponent,
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

  // UI state
  protected readonly showFilters = signal(false);
  protected readonly showSaveViewDialog = signal(false);
  protected readonly showManageViewsDialog = signal(false);

  // Discovery state from service
  protected readonly profiles = this.discoveryService.profiles;
  protected readonly loading = this.discoveryService.loading;
  protected readonly filters = this.discoveryService.filters;
  protected readonly sort = this.discoveryService.sort;
  protected readonly savedViews = this.discoveryService.savedViews;
  protected readonly activeView = this.discoveryService.activeView;
  protected readonly hasMore = this.discoveryService.hasMore;
  protected readonly totalEstimate = this.discoveryService.totalEstimate;
  protected readonly activeFilterCount = this.discoveryService.activeFilterCount;

  // Filter options from service
  protected readonly connectionTypeOptions = this.discoveryService.connectionTypeOptions;
  protected readonly lifestyleOptions = this.discoveryService.lifestyleOptions;
  protected readonly valuesOptions = this.discoveryService.valuesOptions;
  protected readonly ethnicityOptions = this.discoveryService.ethnicityOptions;
  protected readonly relationshipStatusOptions = this.discoveryService.relationshipStatusOptions;
  protected readonly childrenOptions = this.discoveryService.childrenOptions;
  protected readonly smokerOptions = this.discoveryService.smokerOptions;
  protected readonly drinkerOptions = this.discoveryService.drinkerOptions;
  protected readonly educationOptions = this.discoveryService.educationOptions;
  protected readonly distanceOptions = this.discoveryService.distanceOptions;
  protected readonly sortOptions = this.discoveryService.sortOptions;

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
    await this.discoveryService.searchProfiles();
  }

  // Sort management
  protected setSort(sort: DiscoverySort): void {
    this.discoveryService.updateSort(sort);
    this.discoveryService.searchProfiles();
  }

  protected getSortLabel(): string {
    const currentSort = this.sort();
    const option = this.sortOptions.find(
      o => o.value.field === currentSort.field && o.value.direction === currentSort.direction
    );
    return option?.label || 'Sort';
  }

  protected isSortActive(sort: DiscoverySort): boolean {
    const currentSort = this.sort();
    return currentSort.field === sort.field && currentSort.direction === sort.direction;
  }

  // View management
  protected applyView(view: SavedView): void {
    this.discoveryService.applyView(view);
    this.discoveryService.searchProfiles();
  }

  protected openSaveViewDialog(): void {
    this.showSaveViewDialog.set(true);
  }

  protected closeSaveViewDialog(): void {
    this.showSaveViewDialog.set(false);
  }

  protected async onSaveView(event: { name: string; isDefault: boolean }): Promise<void> {
    await this.discoveryService.saveView(event.name, event.isDefault);
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
  protected async loadMore(): Promise<void> {
    await this.discoveryService.loadMore();
  }

  // Profile actions
  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
  }

  protected onViewProfile(profile: DiscoverableProfile): void {
    this.router.navigate(['/user', profile.uid]);
  }

  protected async onFavoriteProfile(profile: DiscoverableProfile): Promise<void> {
    await this.favoriteService.toggleFavorite(profile.uid);
  }

  protected async onMessageProfile(profile: DiscoverableProfile): Promise<void> {
    const conversationId = await this.messageService.startConversation(
      profile.uid,
      { displayName: profile.displayName, photoURL: profile.photos[0] || null }
    );
    
    if (conversationId) {
      this.messageService.openConversation({
        id: conversationId,
        otherUser: {
          uid: profile.uid,
          displayName: profile.displayName,
          photoURL: profile.photos[0] || null,
        },
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
        isArchived: false,
      });
      
      this.router.navigate(['/messages', conversationId]);
    }
  }
}
