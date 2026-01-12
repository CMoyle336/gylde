import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed, PLATFORM_ID, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SlicePipe } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ActivityService } from '../../core/services/activity.service';
import { MessageService } from '../../core/services/message.service';
import { MatchesService } from '../../core/services/matches.service';
import { ActivityDisplay } from '../../core/interfaces';
import { PhotoAccessDialogComponent } from '../../components/photo-access-dialog';

@Component({
  selector: 'app-shell',
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    SlicePipe,
    MatSidenavModule,
    MatMenuModule,
    MatDividerModule,
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
  private readonly translateService = inject(TranslateService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialog = inject(MatDialog);

  // Message state
  protected readonly messageUnreadCount = this.messageService.totalUnreadCount;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly profileCompletion = signal(75);
  
  // Sidebar state
  protected readonly sidenavOpen = signal(false);
  protected readonly sidenavExpanded = signal(true);
  protected readonly isMobile = signal(false);
  protected readonly activityExpanded = signal(true);
  
  // Current user info
  protected readonly currentUser = this.authService.user;
  protected readonly userPhotoURL = computed(() => this.currentUser()?.photoURL ?? null);

  // Matches badge count (sum of favorited-me and viewed-me counts)
  protected readonly matchesBadgeCount = computed(() => 
    this.matchesService.favoritedMeCount() + this.matchesService.viewedMeCount()
  );

  protected readonly navItems = [
    { id: 'discover', path: '/discover', icon: 'explore', labelKey: 'DISCOVER' },
    { id: 'matches', path: '/matches', icon: 'favorite', labelKey: 'MATCHES' },
    { id: 'messages', path: '/messages', icon: 'chat_bubble', labelKey: 'MESSAGES' },
    { id: 'profile', path: '/profile', icon: 'person', labelKey: 'PROFILE' },
    { id: 'settings', path: '/settings', icon: 'settings', labelKey: 'SETTINGS' },
  ];

  // Real-time activity feed
  protected readonly recentActivity = this.activityService.activities;
  protected readonly unreadActivityCount = this.activityService.unreadCount;

  ngOnInit(): void {
    this.favoriteService.loadFavorites();
    this.activityService.subscribeToActivities();
    this.messageService.subscribeToConversations();
    this.matchesService.loadBadgeCounts();
    this.checkScreenSize();
    
    // Track user activity
    this.userProfileService.updateLastActive();
    
    // Load user's language preference
    this.loadUserLanguage();
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
    this.sidenavExpanded.update(v => !v);
  }

  protected onNavItemClick(): void {
    // Close sidenav on mobile when clicking nav item
    if (this.isMobile()) {
      this.sidenavOpen.set(false);
    }
  }

  ngOnDestroy(): void {
    this.activityService.unsubscribeFromActivities();
    this.messageService.cleanup();
  }

  protected async onLogout(): Promise<void> {
    await this.authService.signOutUser();
    this.router.navigate(['/']);
  }

  protected isMessagesWithActiveChat(): boolean {
    return this.router.url.startsWith('/messages') && !!this.activeConversation();
  }

  protected async onActivityClick(activity: ActivityDisplay): Promise<void> {
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
      width: '540px',
      maxWidth: '95vw',
    });
  }

  protected markAllActivitiesAsRead(): void {
    this.activityService.markAllAsRead();
  }

  protected toggleActivitySection(): void {
    this.activityExpanded.update(v => !v);
  }
}
