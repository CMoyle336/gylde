import { ChangeDetectionStrategy, Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { RemoteConfigService } from '../../core/services/remote-config.service';
import { FeedService, FeedTab, FeedSubFilter } from '../../core/services/feed.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { BlockService } from '../../core/services/block.service';
import { PostDisplay, FeedFilter } from '../../core/interfaces';
import { PostCardComponent } from '../../components/post-card';
import { PostCommentsComponent, PostCommentsDialogData } from '../../components/post-comments';
import { FeedSidebarComponent } from '../../components/feed-sidebar';

@Component({
  selector: 'app-feed',
  templateUrl: './feed.html',
  styleUrl: './feed.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatMenuModule,
    TranslateModule,
    PostCardComponent,
    FeedSidebarComponent,
  ],
})
export class FeedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly remoteConfigService = inject(RemoteConfigService);
  private readonly feedService = inject(FeedService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly blockService = inject(BlockService);

  // Remote config state
  readonly configInitialized = this.remoteConfigService.initialized;
  readonly feedEnabled = this.remoteConfigService.featureFeedEnabled;

  // Subscription state
  readonly isPremium = this.subscriptionService.isPremium;

  // Feed state from service
  readonly posts = this.feedService.posts;
  readonly loading = this.feedService.loading;
  readonly loadingMore = this.feedService.loadingMore;
  readonly error = this.feedService.error;
  readonly hasMore = this.feedService.hasMore;
  readonly isEmpty = this.feedService.isEmpty;
  readonly activeFilter = this.feedService.activeFilter;
  readonly filterOptions = this.feedService.filterOptions;
  readonly deletingPostId = this.feedService.deletingPostId;
  
  // Tab navigation state
  readonly activeTab = this.feedService.activeTab;
  readonly activeSubFilter = this.feedService.activeSubFilter;
  readonly tabOptions = this.feedService.tabOptions;
  readonly subFilterOptions = this.feedService.subFilterOptions;

  // Mobile drawer state
  readonly drawerOpen = signal(false);

  // Placeholder features (for coming soon view)
  readonly features = [
    {
      icon: 'dynamic_feed',
      titleKey: 'FEED.FEATURES.SHARE.TITLE',
      descriptionKey: 'FEED.FEATURES.SHARE.DESCRIPTION',
    },
    {
      icon: 'favorite',
      titleKey: 'FEED.FEATURES.ENGAGE.TITLE',
      descriptionKey: 'FEED.FEATURES.ENGAGE.DESCRIPTION',
    },
    {
      icon: 'link',
      titleKey: 'FEED.FEATURES.INSPIRE.TITLE',
      descriptionKey: 'FEED.FEATURES.INSPIRE.DESCRIPTION',
    },
    {
      icon: 'visibility',
      titleKey: 'FEED.FEATURES.CONNECTED.TITLE',
      descriptionKey: 'FEED.FEATURES.CONNECTED.DESCRIPTION',
    },
    {
      icon: 'lock',
      titleKey: 'FEED.FEATURES.PRIVACY.TITLE',
      descriptionKey: 'FEED.FEATURES.PRIVACY.DESCRIPTION',
    },
    {
      icon: 'verified',
      titleKey: 'FEED.FEATURES.AUTHENTIC.TITLE',
      descriptionKey: 'FEED.FEATURES.AUTHENTIC.DESCRIPTION',
    },
  ];

  ngOnInit(): void {
    if (this.feedEnabled()) {
      // Reset to feed tab if non-premium user had private tab saved
      if (this.activeTab() === 'private' && !this.isPremium()) {
        this.feedService.setTab('feed');
      }
      this.feedService.subscribeToFeed();
    }
  }

  async loadMore(): Promise<void> {
    await this.feedService.loadMore();
  }

  refresh(): void {
    this.feedService.refresh();
  }

  onFilterChange(filter: FeedFilter): void {
    this.feedService.setFilter(filter);
  }

  onTabChange(tab: FeedTab): void {
    // Show upgrade prompt for non-premium users trying to access private tab
    if (tab === 'private' && !this.isPremium()) {
      this.subscriptionService.showUpgradePrompt();
      return;
    }
    this.feedService.setTab(tab);
  }

  onSubFilterChange(subFilter: FeedSubFilter): void {
    this.feedService.setSubFilter(subFilter);
  }

  toggleDrawer(): void {
    this.drawerOpen.update(open => !open);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  onPostCreated(): void {
    // Feed is automatically refreshed by the service
  }

  async onLike(post: PostDisplay): Promise<void> {
    await this.feedService.toggleLike(post);
  }

  onComment(post: PostDisplay): void {
    this.dialog.open(PostCommentsComponent, {
      data: { post } as PostCommentsDialogData,
      panelClass: 'comments-dialog-panel',
      width: '700px',
      maxWidth: '95vw',
      height: '85vh',
      maxHeight: '90vh',
    });
  }

  onAuthorClick(post: PostDisplay): void {
    this.router.navigate(['/profile', post.author.uid]);
  }

  async onDelete(post: PostDisplay): Promise<void> {
    // TODO: Add confirmation dialog
    await this.feedService.deletePost(post.id);
  }

  async onReport(post: PostDisplay): Promise<void> {
    // TODO: Add report dialog
    await this.feedService.reportPost(post.id);
  }

  async onBlock(post: PostDisplay): Promise<void> {
    const success = await this.blockService.blockUser(post.author.uid);
    if (success) {
      // Remove the blocked user's posts from the feed
      this.feedService.removePostsByUser(post.author.uid);
    }
  }

  trackByPostId(index: number, post: PostDisplay): string {
    return post.id;
  }
}
