import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DiscoveryService } from '../../core/services/discovery.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { DiscoverableProfile } from '../../core/interfaces';

@Component({
  selector: 'app-discover',
  templateUrl: './discover.html',
  styleUrl: './discover.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class DiscoverComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly discoveryService = inject(DiscoveryService);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);

  protected readonly showDistanceFilter = signal(false);
  protected readonly distanceOptions = [10, 25, 50, 100, 250, null];
  protected readonly selectedDistance = signal<number | null>(50);

  protected readonly profiles = this.discoveryService.filteredProfiles;
  protected readonly loading = this.discoveryService.loading;
  protected readonly favoritedUserIds = this.favoriteService.favoritedUserIds;

  ngOnInit(): void {
    this.loadProfiles();
  }

  protected async loadProfiles(): Promise<void> {
    await this.discoveryService.loadProfiles();
  }

  protected isFavorited(userId: string): boolean {
    return this.favoritedUserIds().has(userId);
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

  protected onViewProfile(profile: DiscoverableProfile): void {
    console.log('View profile:', profile.uid);
    // TODO: Navigate to profile detail
  }

  protected async onFavoriteProfile(profile: DiscoverableProfile): Promise<void> {
    await this.favoriteService.toggleFavorite(profile.uid);
  }

  protected async onMessageProfile(profile: DiscoverableProfile): Promise<void> {
    const conversationId = await this.messageService.startConversation(
      profile.uid,
      { displayName: profile.displayName, photoURL: profile.photos[0] || null }
    );
    
    if (conversationId) {
      this.messageService.openConversation({
        id: conversationId,
        otherUser: {
          uid: profile.uid,
          displayName: profile.displayName,
          photoURL: profile.photos[0] || null,
        },
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
      });
      
      this.router.navigate(['/messages']);
    }
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
