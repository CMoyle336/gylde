import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DiscoverableProfile } from '../../../../core/interfaces';

@Component({
  selector: 'app-profile-card',
  templateUrl: './profile-card.html',
  styleUrl: './profile-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
})
export class ProfileCardComponent {
  // Inputs
  readonly profile = input.required<DiscoverableProfile>();
  readonly isFavorited = input<boolean>(false);

  // Outputs
  readonly messageClick = output<DiscoverableProfile>();
  readonly viewClick = output<DiscoverableProfile>();
  readonly favoriteClick = output<DiscoverableProfile>();

  protected get photoUrl(): string | null {
    const photos = this.profile().photos;
    return photos?.length > 0 ? photos[0] : null;
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

  protected formatLastActive(date: Date | undefined): string {
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
