import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { FeedService, FeedTab, FeedSubFilter } from '../../core/services/feed.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { BlockService } from '../../core/services/block.service';
import { PostDisplay, FeedFilter } from '../../core/interfaces';
import { PostCardComponent } from '../../components/post-card';
import { PostCommentsComponent, PostCommentsDialogData } from '../../components/post-comments';
import { PostComposerComponent } from '../../components/post-composer';
import { FeedSidebarComponent } from '../../components/feed-sidebar';
import { BlockConfirmDialogComponent, BlockConfirmDialogData } from '../../components/block-confirm-dialog';
import { ReportDialogComponent, ReportDialogData } from '../../components/report-dialog';

@Component({
  selector: 'app-feed',
  templateUrl: './feed.html',
  styleUrl: './feed.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatMenuModule,
    TranslateModule,
    PostCardComponent,
    PostComposerComponent,
    FeedSidebarComponent,
  ],
})
export class FeedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly feedService = inject(FeedService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly blockService = inject(BlockService);

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

  ngOnInit(): void {
    // Reset to feed tab if non-premium user had private tab saved
    if (this.activeTab() === 'private' && !this.isPremium()) {
      this.feedService.setTab('feed');
    }
    this.feedService.subscribeToFeed();
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

  onReport(post: PostDisplay): void {
    const dialogRef = this.dialog.open(ReportDialogComponent, {
      data: {
        userId: post.author.uid,
        displayName: post.author.displayName || 'This user',
        postId: post.id,
      } as ReportDialogData,
      panelClass: 'report-dialog-panel',
      width: '420px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe((reported: boolean) => {
      if (reported) {
        // Optionally remove the post from view after reporting
        // For now, we just let the user know it was reported via the dialog
      }
    });
  }

  onBlock(post: PostDisplay): void {
    const dialogRef = this.dialog.open(BlockConfirmDialogComponent, {
      data: {
        userId: post.author.uid,
        displayName: post.author.displayName || 'This user',
      } as BlockConfirmDialogData,
      panelClass: 'block-confirm-dialog-panel',
      width: '400px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe((blocked: boolean) => {
      if (blocked) {
        // Remove the blocked user's posts from the feed
        this.feedService.removePostsByUser(post.author.uid);
      }
    });
  }

  trackByPostId(index: number, post: PostDisplay): string {
    return post.id;
  }
}
