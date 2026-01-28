import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { getTierDisplay, ReputationTier } from '../../core/interfaces';

export type AvatarSize = 'small' | 'medium' | 'large';

@Component({
  selector: 'app-reputation-avatar',
  templateUrl: './reputation-avatar.html',
  styleUrl: './reputation-avatar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
})
export class ReputationAvatarComponent {
  // Inputs
  readonly photoURL = input<string | null | undefined>(null);
  readonly displayName = input<string | null | undefined>(null);
  readonly reputationTier = input<ReputationTier | string | null | undefined>(null);
  readonly size = input<AvatarSize>('medium');
  readonly showTooltip = input(true);

  // Computed properties
  protected readonly tierDisplay = computed(() => {
    const tier = this.reputationTier() as ReputationTier | null | undefined;
    if (!tier) return null;
    return getTierDisplay(tier);
  });

  protected readonly borderColor = computed(() => {
    const display = this.tierDisplay();
    return display?.color || 'transparent';
  });

  protected readonly tooltip = computed(() => {
    if (!this.showTooltip()) return '';
    const display = this.tierDisplay();
    if (!display) return '';
    return `${display.label}: ${display.description}`;
  });

  protected readonly hasTier = computed(() => {
    const tier = this.reputationTier();
    return !!tier && tier !== 'new'; // 'new' tier doesn't show a visible border
  });

  protected readonly sizeClass = computed(() => `size-${this.size()}`);

  protected readonly altText = computed(() => this.displayName() || 'User');

  // Handle image error
  protected onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }
}
