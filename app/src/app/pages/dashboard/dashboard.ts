import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed, PLATFORM_ID, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { DiscoveryService } from '../../core/services/discovery.service';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ActivityService } from '../../core/services/activity.service';
import { DiscoverableProfile } from '../../core/interfaces';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, FormsModule, SlicePipe, MatSidenavModule, MatMenuModule, MatDividerModule],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly discoveryService = inject(DiscoveryService);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly activityService = inject(ActivityService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly activeNav = signal<string>('discover');
  protected readonly profileCompletion = signal(75);
  protected readonly showDistanceFilter = signal(false);
  
  // Sidebar state
  protected readonly sidenavOpen = signal(false); // For mobile overlay
  protected readonly sidenavExpanded = signal(true); // For desktop collapsed/expanded
  protected readonly isMobile = signal(false);
  
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
    this.checkScreenSize();
    
    // Track user activity
    this.userProfileService.updateLastActive();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenSize();
  }

  private checkScreenSize(): void {
    if (isPlatformBrowser(this.platformId)) {
      const mobile = window.innerWidth < 1024;
      this.isMobile.set(mobile);
      
      // Default to collapsed on mobile
      if (mobile && this.sidenavExpanded()) {
        this.sidenavExpanded.set(false);
      }
    }
  }

  protected toggleSidenav(): void {
    this.sidenavOpen.update(v => !v);
  }

  protected toggleSidenavExpanded(): void {
    this.sidenavExpanded.update(v => !v);
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
