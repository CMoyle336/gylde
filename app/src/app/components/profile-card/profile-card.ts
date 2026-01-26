import { ChangeDetectionStrategy, Component, input, output, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { ReputationTier, shouldShowPublicBadge } from '../../core/interfaces';
import { ReputationBadgeComponent } from '../reputation-badge';
import { FounderBadgeComponent } from '../founder-badge';

/**
 * Common profile data interface for the profile card component.
 * This is a minimal interface that both DiscoverableProfile and MatchProfile can satisfy.
 */
export interface ProfileCardData {
  uid: string;
  displayName: string | null;
  age?: number | null;
  city?: string | null;
  country?: string | null;
  photos?: string[];
  photoURL?: string | null; // Fallback for single photo
  identityVerified?: boolean;
  isOnline?: boolean;
  showOnlineStatus?: boolean;
  showLastActive?: boolean;
  lastActiveAt?: Date | null;
  connectionTypes?: string[];
  tagline?: string; // Short phrase displayed on card
  interactionDate?: Date; // For matches page - when the interaction happened
  reputationTier?: ReputationTier; // User's reputation tier for public badge
  isFounder?: boolean; // Whether the user is a founder of their city
}

@Component({
  selector: 'app-profile-card',
  templateUrl: './profile-card.html',
  styleUrl: './profile-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, MatProgressSpinnerModule, TranslateModule, ReputationBadgeComponent, FounderBadgeComponent],
})
export class ProfileCardComponent {
  // Inputs
  readonly profile = input.required<ProfileCardData>();
  readonly isFavorited = input<boolean>(false);
  readonly showInteractionTime = input<boolean>(false); // Show when the interaction happened
  readonly messagingLoading = input<boolean>(false); // Show loading spinner on message button

  // Outputs
  readonly messageClick = output<ProfileCardData>();
  readonly viewClick = output<ProfileCardData>();
  readonly favoriteClick = output<ProfileCardData>();

  // Computed: whether to show public reputation badge (only active+ tiers)
  protected readonly showReputationBadge = computed(() => {
    const tier = this.profile().reputationTier;
    return tier ? shouldShowPublicBadge(tier) : false;
  });

  protected readonly reputationTier = computed(() => {
    return this.profile().reputationTier ?? 'new';
  });

  protected get photoUrl(): string | null {
    const p = this.profile();
    // Use photoURL (the designated profile photo) first, fallback to first photo in array
    if (p.photoURL) return p.photoURL;
    if (p.photos?.length) return p.photos[0];
    return null;
  }

  protected get isVerified(): boolean {
    const p = this.profile();
    return p.identityVerified || false;
  }

  protected onMessage(): void {
    this.messageClick.emit(this.profile());
  }

  protected onView(): void {
    this.viewClick.emit(this.profile());
  }

  protected onFavorite(): void {
    this.favoriteClick.emit(this.profile());
  }

  protected connectionTypeKey(type: string): string {
    switch (type) {
      case 'intentional-dating':
        return 'INTENTIONAL_DATING';
      case 'long-term':
        return 'LONG_TERM';
      case 'mentorship':
        return 'MENTORSHIP';
      case 'lifestyle-aligned':
        return 'LIFESTYLE_ALIGNED';
      case 'exploring':
        return 'EXPLORING';
      default:
        return 'OTHER';
    }
  }

  protected lastActiveKey(date: Date | null | undefined): string {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(days / 7);

    if (minutes < 1) return 'TIME.JUST_NOW';
    if (minutes < 60) return 'TIME.MINUTES_AGO_SHORT';
    if (hours < 24) return 'TIME.HOURS_AGO_SHORT';
    if (days === 1) return 'TIME.YESTERDAY';
    if (days < 7) return 'TIME.DAYS_AGO_SHORT';
    return 'TIME.WEEKS_AGO_SHORT';
  }

  protected lastActiveParams(date: Date | null | undefined): Record<string, number> {
    if (!date) return {};
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(days / 7);

    if (minutes < 1) return {};
    if (minutes < 60) return { minutes };
    if (hours < 24) return { hours };
    if (days === 1) return {};
    if (days < 7) return { days };
    return { weeks: Math.max(1, weeks) };
  }
}
