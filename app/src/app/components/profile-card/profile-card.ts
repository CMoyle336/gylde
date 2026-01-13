import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

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
  verified?: boolean;
  isVerified?: boolean; // Alternative property name
  isOnline?: boolean;
  showOnlineStatus?: boolean;
  showLastActive?: boolean;
  lastActiveAt?: Date | null;
  connectionTypes?: string[];
  tagline?: string; // Short phrase displayed on card
  interactionDate?: Date; // For matches page - when the interaction happened
}

@Component({
  selector: 'app-profile-card',
  templateUrl: './profile-card.html',
  styleUrl: './profile-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
})
export class ProfileCardComponent {
  // Inputs
  readonly profile = input.required<ProfileCardData>();
  readonly isFavorited = input<boolean>(false);
  readonly showInteractionTime = input<boolean>(false); // Show when the interaction happened

  // Outputs
  readonly messageClick = output<ProfileCardData>();
  readonly viewClick = output<ProfileCardData>();
  readonly favoriteClick = output<ProfileCardData>();

  protected get photoUrl(): string | null {
    const p = this.profile();
    // Use photoURL (the designated profile photo) first, fallback to first photo in array
    if (p.photoURL) return p.photoURL;
    if (p.photos?.length) return p.photos[0];
    return null;
  }

  protected get isVerified(): boolean {
    const p = this.profile();
    return p.verified || p.isVerified || false;
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

  protected formatConnectionType(type: string): string {
    const labels: Record<string, string> = {
      'intentional-dating': 'Intentional Dating',
      'long-term': 'Long-term',
      'mentorship': 'Mentorship',
      'lifestyle-aligned': 'Lifestyle Aligned',
      'exploring': 'Exploring',
    };
    return labels[type] || type;
  }

  protected formatLastActive(date: Date | null | undefined): string {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
}
