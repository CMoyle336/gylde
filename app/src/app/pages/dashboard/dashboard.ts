import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { DiscoveryService } from '../../core/services/discovery.service';
import { AuthService } from '../../core/services/auth.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ActivityService } from '../../core/services/activity.service';
import { DiscoverableProfile } from '../../core/interfaces';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, FormsModule, SlicePipe],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly discoveryService = inject(DiscoveryService);
  private readonly authService = inject(AuthService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly activityService = inject(ActivityService);

  protected readonly activeNav = signal<string>('discover');
  protected readonly profileCompletion = signal(75);
  protected readonly showDistanceFilter = signal(false);
  
  // Current user info
  protected readonly currentUser = this.authService.user;
  protected readonly userPhotoURL = computed(() => this.currentUser()?.photoURL ?? null);
  
  // Favorite state
  protected readonly favoritedUserIds = this.favoriteService.favoritedUserIds;

  // Distance filter options
  protected readonly distanceOptions = [10, 25, 50, 100, 250, null]; // null = unlimited
  protected readonly selectedDistance = signal<number | null>(50);

  protected readonly navItems = [
    { id: 'discover', icon: 'explore', labelKey: 'DISCOVER' },
    { id: 'matches', icon: 'favorite', labelKey: 'MATCHES', badge: 3 },
    { id: 'messages', icon: 'chat_bubble', labelKey: 'MESSAGES', badge: 2 },
    { id: 'profile', icon: 'person', labelKey: 'PROFILE' },
    { id: 'settings', icon: 'settings', labelKey: 'SETTINGS' },
  ];

  // Connect to discovery service
  protected readonly profiles = this.discoveryService.filteredProfiles;
  protected readonly loading = this.discoveryService.loading;
  protected readonly filters = this.discoveryService.filters;

  // Real-time activity feed
  protected readonly recentActivity = this.activityService.activities;
  protected readonly unreadActivityCount = this.activityService.unreadCount;

  ngOnInit(): void {
    this.loadProfiles();
    this.favoriteService.loadFavorites();
    this.activityService.subscribeToActivities();
  }

  ngOnDestroy(): void {
    this.activityService.unsubscribeFromActivities();
  }

  protected async loadProfiles(): Promise<void> {
    await this.discoveryService.loadProfiles();
  }
  
  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
  }

  protected setActiveNav(id: string): void {
    this.activeNav.set(id);
  }

  protected toggleDistanceFilter(): void {
    this.showDistanceFilter.update(v => !v);
  }

  protected setDistanceFilter(distance: number | null): void {
    this.selectedDistance.set(distance);
    this.discoveryService.setMaxDistance(distance);
    this.showDistanceFilter.set(false);
  }

  protected getDistanceLabel(distance: number | null): string {
    if (distance === null) return 'Any distance';
    return `Within ${distance} mi`;
  }

  protected async onLogout(): Promise<void> {
    await this.authService.signOutUser();
    this.router.navigate(['/']);
  }

  protected onViewProfile(profile: DiscoverableProfile): void {
    console.log('View profile:', profile.uid);
    // TODO: Navigate to profile detail
  }

  protected async onFavoriteProfile(profile: DiscoverableProfile): Promise<void> {
    await this.favoriteService.toggleFavorite(profile.uid);
  }

  protected onPassProfile(profile: DiscoverableProfile): void {
    console.log('Pass profile:', profile.uid);
    // TODO: Implement pass functionality
  }

  protected getProfilePhoto(profile: DiscoverableProfile): string | null {
    return profile.photos.length > 0 ? profile.photos[0] : null;
  }

  protected formatDistance(distance: number | undefined): string {
    if (distance === undefined) return '';
    if (distance < 1) return '< 1 mi away';
    return `${distance} mi away`;
  }
}
