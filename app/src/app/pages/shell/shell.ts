import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed, PLATFORM_ID, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SlicePipe } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ActivityService } from '../../core/services/activity.service';
import { MessageService } from '../../core/services/message.service';

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
  private readonly platformId = inject(PLATFORM_ID);

  // Message state
  protected readonly messageUnreadCount = this.messageService.totalUnreadCount;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly profileCompletion = signal(75);
  
  // Sidebar state
  protected readonly sidenavOpen = signal(false);
  protected readonly sidenavExpanded = signal(true);
  protected readonly isMobile = signal(false);
  
  // Current user info
  protected readonly currentUser = this.authService.user;
  protected readonly userPhotoURL = computed(() => this.currentUser()?.photoURL ?? null);

  protected readonly navItems = [
    { id: 'discover', path: '/discover', icon: 'explore', labelKey: 'DISCOVER' },
    { id: 'matches', path: '/matches', icon: 'favorite', labelKey: 'MATCHES', badge: 3 },
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
}
