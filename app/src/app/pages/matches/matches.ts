import { ChangeDetectionStrategy, Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatchesService, MatchTab } from '../../core/services/matches.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { ProfileCardComponent, ProfileCardData } from '../../components/profile-card';
import { ProfileCardSkeletonComponent } from '../../components/profile-card-skeleton';

// Tabs that require premium subscription
const PREMIUM_TABS: MatchTab[] = ['favorited-me', 'viewed-me'];

const VALID_TABS: MatchTab[] = ['my-matches', 'favorited-me', 'viewed-me', 'my-favorites', 'my-views'];

@Component({
  selector: 'app-matches',
  templateUrl: './matches.html',
  styleUrl: './matches.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    ProfileCardComponent,
    ProfileCardSkeletonComponent,
  ],
})
export class MatchesComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly matchesService = inject(MatchesService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly analytics = inject(AnalyticsService);

  protected readonly isPremium = this.subscriptionService.isPremium;
  protected readonly messagingUserId = signal<string | null>(null); // Track which user is being messaged

  protected readonly loading = this.matchesService.loading;
  protected readonly initialized = this.matchesService.initialized;
  protected readonly activeTab = this.matchesService.activeTab;
  protected readonly profiles = this.matchesService.profiles;
  protected readonly isEmpty = this.matchesService.isEmpty;
  protected readonly favoritedUserIds = this.favoriteService.favoritedUserIds;
  protected readonly matchesCount = this.matchesService.matchesCount;
  protected readonly favoritedMeCount = this.matchesService.favoritedMeCount;
  protected readonly viewedMeCount = this.matchesService.viewedMeCount;

  // Skeleton count for loading state
  protected readonly skeletonCards = Array.from({ length: 6 }, (_, i) => i);

  async ngOnInit(): Promise<void> {
    // Load badge counts first
    await this.matchesService.loadBadgeCounts();
    
    // Read tab from query params
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    
    // Priority: 1) URL query param, 2) service's remembered tab state
    const initialTab: MatchTab = this.isValidTab(tabParam) 
      ? tabParam 
      : this.matchesService.activeTab();
    
    // Set initial tab (which resets its badge and loads profiles)
    // Note: favoriteService.loadFavorites() is already called in ShellComponent
    this.matchesService.setTab(initialTab);
    
    // Ensure URL has the tab param
    if (tabParam !== initialTab) {
      this.updateUrlWithTab(initialTab);
    }
  }

  protected setTab(tab: MatchTab): void {
    // Check if this is a premium tab and user isn't premium
    if (PREMIUM_TABS.includes(tab) && !this.isPremium()) {
      const feature = tab === 'favorited-me' ? 'canSeeWhoFavorited' : 'canSeeWhoViewedProfile';
      this.subscriptionService.showUpgradePrompt(feature);
      return;
    }
    
    this.analytics.trackMatchesTabChanged(tab);
    this.matchesService.setTab(tab);
    this.updateUrlWithTab(tab);
  }

  private isValidTab(tab: string | null): tab is MatchTab {
    return tab !== null && VALID_TABS.includes(tab as MatchTab);
  }

  private updateUrlWithTab(tab: MatchTab): void {
    // Only update URL on the client to avoid SSR redirect loops
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onViewProfile(profile: ProfileCardData): void {
    this.analytics.trackProfileView(profile.uid, 'matches');
    this.router.navigate(['/user', profile.uid]);
  }

  protected async onMessage(profile: ProfileCardData): Promise<void> {
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
        this.analytics.trackConversationStarted('matches');
        
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

  protected async onFavorite(profile: ProfileCardData): Promise<void> {
    const wasUnfavorited = this.isFavorited(profile.uid);
    await this.favoriteService.toggleFavorite(profile.uid);
    
    if (wasUnfavorited) {
      this.analytics.trackFavoriteRemoved('matches');
    } else {
      this.analytics.trackFavoriteAdded('matches');
    }
    
    // If we just unfavorited, remove from view on relevant tabs
    if (wasUnfavorited) {
      const tab = this.activeTab();
      // Remove from my-favorites (we unfavorited them)
      // Remove from my-matches (unfavoriting breaks the match)
      if (tab === 'my-favorites' || tab === 'my-matches') {
        this.matchesService.removeProfile(profile.uid);
      }
    }
  }

  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
  }

  protected getEmptyMessage(): string {
    switch (this.activeTab()) {
      case 'my-matches':
        return "You don't have any matches yet. When someone you favorite also favorites you, they'll appear here!";
      case 'favorited-me':
        return 'No one has favorited you yet. Keep your profile active!';
      case 'viewed-me':
        return 'No one has viewed your profile yet.';
      case 'my-favorites':
        return "You haven't favorited anyone yet. Explore profiles to find your match!";
      case 'my-views':
        return "You haven't viewed any profiles yet.";
    }
  }

  protected getEmptyIcon(): string {
    switch (this.activeTab()) {
      case 'my-matches':
        return 'favorite';
      case 'favorited-me':
      case 'my-favorites':
        return 'favorite';
      case 'viewed-me':
      case 'my-views':
        return 'visibility';
    }
  }
}
