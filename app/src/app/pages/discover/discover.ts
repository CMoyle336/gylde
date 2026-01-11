import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { DiscoveryService } from '../../core/services/discovery.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { DiscoverableProfile, DiscoveryFilters, DiscoverySort, SavedView } from '../../core/interfaces';

@Component({
  selector: 'app-discover',
  templateUrl: './discover.html',
  styleUrl: './discover.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
  ],
})
export class DiscoverComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly discoveryService = inject(DiscoveryService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);

  // UI state
  protected readonly showFilters = signal(false);
  protected readonly showAdvancedFilters = signal(false);
  protected readonly showSaveViewDialog = signal(false);
  protected readonly showManageViewsDialog = signal(false);

  // Dialog form values
  protected newViewName = '';
  protected newViewIsDefault = false;

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

  protected toggleAdvancedFilters(): void {
    this.showAdvancedFilters.update(v => !v);
  }

  // Filter management
  protected updateFilter(key: keyof DiscoveryFilters, value: unknown): void {
    if (key === 'minAge' || key === 'maxAge') {
      const numValue = parseInt(value as string, 10);
      if (!isNaN(numValue)) {
        this.discoveryService.updateFilters({ [key]: numValue });
      }
    } else {
      this.discoveryService.updateFilters({ [key]: value } as Partial<DiscoveryFilters>);
    }
  }

  protected toggleArrayFilter(key: keyof DiscoveryFilters, value: string): void {
    const currentArray = (this.filters()[key] as string[]) || [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    this.discoveryService.updateFilters({ [key]: newArray } as Partial<DiscoveryFilters>);
  }

  protected isFilterSelected(key: keyof DiscoveryFilters, value: string): boolean {
    const currentArray = (this.filters()[key] as string[]) || [];
    return currentArray.includes(value);
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
    this.newViewName = '';
    this.newViewIsDefault = false;
    this.showSaveViewDialog.set(true);
  }

  protected closeSaveViewDialog(): void {
    this.showSaveViewDialog.set(false);
  }

  protected async saveView(): Promise<void> {
    if (!this.newViewName) return;
    await this.discoveryService.saveView(this.newViewName, this.newViewIsDefault);
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
    console.log('View profile:', profile.uid);
    // TODO: Navigate to profile detail
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
      });
      
      this.router.navigate(['/messages', conversationId]);
    }
  }

  protected getProfilePhoto(profile: DiscoverableProfile): string | null {
    return profile.photos?.length > 0 ? profile.photos[0] : null;
  }

  protected formatDistance(distance: number | undefined): string {
    if (distance === undefined) return '';
    if (distance < 1) return '< 1 mi';
    return `${distance} mi`;
  }

  protected formatConnectionType(type: string): string {
    const labels: Record<string, string> = {
      'intentional-dating': 'Intentional Dating',
      'long-term': 'Long-term',
      'mentorship': 'Mentorship',
      'lifestyle-aligned': 'Lifestyle Aligned',
      'exploring': 'Exploring',
    };
    return labels[type] || type;
  }

  protected formatLastActive(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
}
