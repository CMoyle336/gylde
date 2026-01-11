import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MatchesService, MatchTab } from '../../core/services/matches.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { ProfileCardComponent, ProfileCardData } from '../../components/profile-card';
import { ProfileCardSkeletonComponent } from '../../components/profile-card-skeleton';

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
  private readonly router = inject(Router);
  private readonly matchesService = inject(MatchesService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = this.matchesService.loading;
  protected readonly activeTab = this.matchesService.activeTab;
  protected readonly profiles = this.matchesService.profiles;
  protected readonly isEmpty = this.matchesService.isEmpty;
  protected readonly favoritedUserIds = this.favoriteService.favoritedUserIds;
  protected readonly favoritedMeCount = this.matchesService.favoritedMeCount;
  protected readonly viewedMeCount = this.matchesService.viewedMeCount;

  // Skeleton count for loading state
  protected readonly skeletonCards = Array.from({ length: 6 }, (_, i) => i);

  ngOnInit(): void {
    this.matchesService.loadBadgeCounts();
    this.matchesService.loadProfiles();
    this.favoriteService.loadFavorites();
  }

  protected setTab(tab: MatchTab): void {
    this.matchesService.setTab(tab);
  }

  protected onViewProfile(profile: ProfileCardData): void {
    this.router.navigate(['/user', profile.uid]);
  }

  protected async onMessage(profile: ProfileCardData): Promise<void> {
    const photoURL = profile.photos?.[0] || profile.photoURL || null;
    const conversationId = await this.messageService.startConversation(
      profile.uid,
      { displayName: profile.displayName, photoURL }
    );

    if (conversationId) {
      this.messageService.openConversation({
        id: conversationId,
        otherUser: {
          uid: profile.uid,
          displayName: profile.displayName || 'Unknown',
          photoURL,
        },
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
        isArchived: false,
      });
      this.router.navigate(['/messages', conversationId]);
    }
  }

  protected async onFavorite(profile: ProfileCardData): Promise<void> {
    await this.favoriteService.toggleFavorite(profile.uid);
  }

  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
  }

  protected getEmptyMessage(): string {
    switch (this.activeTab()) {
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
      case 'favorited-me':
      case 'my-favorites':
        return 'favorite';
      case 'viewed-me':
      case 'my-views':
        return 'visibility';
    }
  }
}
