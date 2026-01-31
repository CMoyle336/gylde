import { ChangeDetectionStrategy, Component, inject, input, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { TranslateModule } from '@ngx-translate/core';
import { FeedTab } from '../../core/services/feed.service';
import { MatchesService } from '../../core/services/matches.service';
import { FeedActivityService } from '../../core/services/feed-activity.service';
import { PrivateAccessService, PrivateAccessRequestDisplay, PrivateAccessGrantDisplay } from '../../core/services/photo-access.service';
import { FeedActivityDisplay } from '../../core/interfaces';

@Component({
  selector: 'app-feed-sidebar',
  templateUrl: './feed-sidebar.html',
  styleUrl: './feed-sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    TranslateModule,
  ],
})
export class FeedSidebarComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly matchesService = inject(MatchesService);
  private readonly feedActivityService = inject(FeedActivityService);
  private readonly privateAccessService = inject(PrivateAccessService);

  // Input
  readonly activeTab = input<FeedTab>('feed');

  // Matches data
  readonly matches = this.matchesService.profiles;
  readonly matchesCount = this.matchesService.matchesCount;
  readonly favoritedMeCount = this.matchesService.favoritedMeCount;
  readonly viewedMeCount = this.matchesService.viewedMeCount;

  // Feed Activity data (likes, comments on posts)
  readonly feedActivities = this.feedActivityService.feedActivities;

  // Private access data
  readonly pendingRequests = this.privateAccessService.pendingRequests;
  readonly pendingRequestsCount = this.privateAccessService.pendingRequestsCount;
  readonly grants = this.privateAccessService.grants;

  // Computed: limit matches to show in sidebar
  readonly displayMatches = computed(() => this.matches().slice(0, 5));

  // Computed: limit feed activities to show in sidebar
  readonly displayFeedActivities = computed(() => this.feedActivities().slice(0, 4));

  // Computed: limit grants to show in sidebar
  readonly displayGrants = computed(() => this.grants().slice(0, 5));

  // Computed: show private access card only on private tab
  readonly showPrivateAccessCard = computed(() => this.activeTab() === 'private');

  // Computed: show matches card only on feed tab
  readonly showMatchesCard = computed(() => this.activeTab() === 'feed');

  ngOnInit(): void {
    // Load matches data for sidebar
    this.matchesService.setTab('my-matches');
  }

  navigateToProfile(userId: string): void {
    this.router.navigate(['/profile', userId]);
  }

  navigateToMatches(): void {
    this.router.navigate(['/matches']);
  }

  navigateToActivity(): void {
    // Could navigate to a full activity page if one exists
    // For now, activities are shown in the sidebar
  }

  async approveRequest(request: PrivateAccessRequestDisplay): Promise<void> {
    await this.privateAccessService.respondToRequest(request.id, 'grant');
  }

  async denyRequest(request: PrivateAccessRequestDisplay): Promise<void> {
    await this.privateAccessService.respondToRequest(request.id, 'deny');
  }

  async revokeAccess(grant: PrivateAccessGrantDisplay): Promise<void> {
    await this.privateAccessService.revokeAccess(grant.id);
  }

  getFeedActivityIcon(activity: FeedActivityDisplay): string {
    if (activity.liked && activity.commented) {
      return 'rate_review'; // Both like and comment
    } else if (activity.liked) {
      return 'favorite';
    } else if (activity.commented) {
      return 'chat_bubble';
    }
    return 'notifications';
  }

  getFeedActivityMessage(activity: FeedActivityDisplay): string {
    return this.feedActivityService.getActivityMessage(activity);
  }
}
