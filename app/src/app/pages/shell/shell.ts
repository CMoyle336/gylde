import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed, PLATFORM_ID, HostListener, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SlicePipe } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ActivityService } from '../../core/services/activity.service';
import { MessageService } from '../../core/services/message.service';
import { MatchesService } from '../../core/services/matches.service';
import { BlockService } from '../../core/services/block.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { RemoteConfigService } from '../../core/services/remote-config.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { ActivityDisplay, TRUST_TASK_UI } from '../../core/interfaces';
import { PhotoAccessDialogComponent } from '../../components/photo-access-dialog';
import { FounderIssueDialogComponent } from '../../components/founder-issue-dialog';

@Component({
  selector: 'app-shell',
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    SlicePipe,
    MatSidenavModule,
    MatTooltipModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
  ],
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly activityService = inject(ActivityService);
  private readonly messageService = inject(MessageService);
  private readonly matchesService = inject(MatchesService);
  private readonly blockService = inject(BlockService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly remoteConfigService = inject(RemoteConfigService);
  private readonly translateService = inject(TranslateService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialog = inject(MatDialog);
  private readonly analytics = inject(AnalyticsService);

  // Message state
  protected readonly messageUnreadCount = this.messageService.totalUnreadCount;
  protected readonly activeConversation = this.messageService.activeConversation;
  // Profile progress from private subcollection (via subscription service)
  private readonly trustData = this.subscriptionService.trustData;
  
  protected readonly profileProgress = computed(() => {
    const data = this.trustData();
    if (!data?.tasks) return 0;
    const completed = Object.values(data.tasks).filter(t => t.completed).length;
    const total = TRUST_TASK_UI.length;
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  });
  
  // Sidebar state - initialize from localStorage
  protected readonly sidenavOpen = signal(false);
  protected readonly sidenavExpanded = signal(this.getStoredState('sidenavExpanded', true));
  protected readonly isMobile = signal(false);
  protected readonly activityExpanded = signal(this.getStoredState('activityExpanded', true));

  private getStoredState(key: string, defaultValue: boolean): boolean {
    if (!isPlatformBrowser(this.platformId)) return defaultValue;
    const stored = localStorage.getItem(key);
    return stored !== null ? stored === 'true' : defaultValue;
  }

  private saveState(key: string, value: boolean): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(key, String(value));
    }
  }
  
  // Current user info
  protected readonly currentUser = this.authService.user;
  // Use profile photoURL from Firestore (user's chosen photo), fallback to auth photoURL (e.g., Google photo)
  protected readonly userPhotoURL = computed(() => {
    const profile = this.userProfileService.profile();
    // Prefer the profile photo from Firestore, fallback to auth user photo (e.g., Google)
    return profile?.photoURL ?? this.currentUser()?.photoURL ?? null;
  });

  // Founder status (source of truth: users/{uid}.isFounder)
  protected readonly isFounder = computed(() => this.userProfileService.profile()?.isFounder === true);
  
  // Show founder report issue button (requires both founder status AND feature flag)
  protected readonly showFounderReportIssue = computed(() =>
    this.isFounder() && this.remoteConfigService.featureReportIssue()
  );

  // Matches badge count
  // - All users: new matches count
  // - Premium users: also includes favorited-me and viewed-me counts
  protected readonly matchesBadgeCount = computed(() => {
    const matchesCount = this.matchesService.matchesCount();
    
    if (this.subscriptionService.isPremium()) {
      return matchesCount + this.matchesService.favoritedMeCount() + this.matchesService.viewedMeCount();
    }
    
    return matchesCount;
  });

  protected readonly navItems = [
    { id: 'discover', path: '/discover', icon: 'explore', labelKey: 'DISCOVER' },
    { id: 'matches', path: '/matches', icon: 'favorite', labelKey: 'MATCHES' },
    { id: 'messages', path: '/messages', icon: 'chat_bubble', labelKey: 'MESSAGES' },
    { id: 'feed', path: '/feed', icon: 'dynamic_feed', labelKey: 'FEED' },
    { id: 'profile', path: '/profile', icon: 'person', labelKey: 'PROFILE' },
    { id: 'settings', path: '/settings', icon: 'settings', labelKey: 'SETTINGS' },
  ];

  // Show "soon" badge for feed only when config is initialized AND feature is disabled
  protected readonly showFeedSoonBadge = computed(() => 
    this.remoteConfigService.initialized() && !this.remoteConfigService.featureFeedEnabled()
  );

  // Real-time activity feed
  protected readonly recentActivity = this.activityService.activities;
  protected readonly unreadActivityCount = this.activityService.unreadCount;

  ngOnInit(): void {
    this.favoriteService.loadFavorites();
    this.activityService.subscribeToActivities();
    this.messageService.subscribeToConversations();
    this.matchesService.loadBadgeCounts();
    this.blockService.loadBlockedUsers();
    this.checkScreenSize();
    
    // Track user activity
    this.userProfileService.updateLastActive();
    
    // Load user's language preference
    this.loadUserLanguage();
    
    // Initialize subscription service (loads trust score + subscription from private subcollection)
    this.subscriptionService.initialize();
    
    // Track page views on navigation
    this.trackNavigationEvents();
  }

  // Effect to reactively update analytics when user data changes
  private readonly analyticsEffect = effect(() => {
    const user = this.currentUser();
    if (!user) return;

    // Set user ID
    this.analytics.setUser(user.uid);

    // Read all reactive signals to track changes
    const profile = this.userProfileService.profile();
    const isPremium = this.subscriptionService.isPremium();
    const reputationData = this.subscriptionService.reputationData();
    const isFounder = this.isFounder();

    // Set user properties for segmentation (updates whenever any signal changes)
    this.analytics.setUserProperties({
      subscription_tier: isPremium ? 'premium' : 'free',
      reputation_tier: reputationData?.tier || 'new',
      is_founder: isFounder,
      profile_complete: !!profile?.onboarding?.photoDetails?.length,
      has_photos: !!(profile?.onboarding?.photoDetails?.length),
      photo_count: profile?.onboarding?.photoDetails?.length || 0,
      language: profile?.settings?.preferences?.language || this.translateService.currentLang || 'en',
      theme: (profile?.settings?.preferences?.theme as 'light' | 'dark' | undefined) || 'dark',
    });
  });

  private trackNavigationEvents(): void {
    // Track route changes
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        const navEnd = event as NavigationEnd;
        const url = navEnd.urlAfterRedirects;
        
        // Extract page name from URL
        let pageName = url.split('?')[0]; // Remove query params
        pageName = pageName.split('/').filter(Boolean)[0] || 'home'; // Get first segment
        
        this.analytics.trackPageView(pageName, {
          full_url: url,
        });
      });
  }

  private async loadUserLanguage(): Promise<void> {
    try {
      const profile = await this.userProfileService.getCurrentUserProfile();
      const language = profile?.settings?.preferences?.language;
      if (language && language !== this.translateService.currentLang) {
        this.translateService.use(language);
      }
    } catch (error) {
      console.error('Error loading user language:', error);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenSize();
  }

  private checkScreenSize(): void {
    if (isPlatformBrowser(this.platformId)) {
      const mobile = window.innerWidth < 1024;
      this.isMobile.set(mobile);
      
      if (mobile && this.sidenavExpanded()) {
        this.sidenavExpanded.set(false);
      }
    }
  }

  protected toggleSidenav(): void {
    this.sidenavOpen.update(v => !v);
  }

  protected toggleSidenavExpanded(): void {
    this.sidenavExpanded.update(v => {
      const newValue = !v;
      this.saveState('sidenavExpanded', newValue);
      return newValue;
    });
  }

  protected onNavItemClick(navItem: { id: string; path: string }): void {
    // Track navigation click
    this.analytics.trackNavigation(navItem.id, 'sidenav');
    
    // Close sidenav on mobile when clicking nav item
    if (this.isMobile()) {
      this.sidenavOpen.set(false);
    }
  }

  ngOnDestroy(): void {
    this.activityService.unsubscribeFromActivities();
    this.messageService.cleanup();
  }

  protected isMessagesWithActiveChat(): boolean {
    return this.router.url.startsWith('/messages') && !!this.activeConversation();
  }

  protected async onActivityClick(activity: ActivityDisplay): Promise<void> {
    // Track activity click
    this.analytics.trackActivityClicked(activity.type);
    
    // Mark as read
    if (!activity.read) {
      this.activityService.markAsRead(activity.id);
    }

    // Close sidenav on mobile
    if (this.isMobile()) {
      this.sidenavOpen.set(false);
    }

    // If the activity has a link, navigate to it
    if (activity.link) {
      this.router.navigateByUrl(activity.link);
      return;
    }

    // Handle activities without links (like photo_access_request which opens a dialog)
    switch (activity.type) {
      case 'photo_access_request':
        // Open dialog to manage photo access (shows all pending requests)
        this.openPhotoAccessDialog();
        break;

      default:
        // Fallback for activities without links
        this.router.navigate(['/discover']);
    }
  }

  private openPhotoAccessDialog(): void {
    this.dialog.open(PhotoAccessDialogComponent, {
      panelClass: 'photo-access-dialog-panel',
      width: '420px',
      maxWidth: '95vw',
    });
  }

  protected openFounderIssueDialog(): void {
    // Close sidenav on mobile first
    if (this.isMobile()) {
      this.sidenavOpen.set(false);
    }

    this.dialog.open(FounderIssueDialogComponent, {
      panelClass: 'founder-issue-dialog-panel',
      width: '480px',
      maxWidth: '95vw',
    });
  }

  protected markAllActivitiesAsRead(): void {
    this.activityService.markAllAsRead();
  }

  protected toggleActivitySection(): void {
    this.activityExpanded.update(v => {
      const newValue = !v;
      this.saveState('activityExpanded', newValue);
      return newValue;
    });
  }

  protected getActivityTooltip(activity: ActivityDisplay): string {
    switch (activity.type) {
      case 'match':
        return `Matched with ${activity.name}`;
      case 'message':
        return `${activity.name} messaged you`;
      case 'favorite':
        return `${activity.name} favorited you`;
      case 'view':
        return `${activity.name} viewed your profile`;
      case 'photo_access_request':
        return `${activity.name} requested access to your private photos`;
      case 'photo_access_granted':
        return `${activity.name} granted you access to their private photos`;
      case 'photo_access_denied':
        return `${activity.name} denied your photo access request`;
      default:
        return `${activity.name} interacted with you`;
    }
  }
}
