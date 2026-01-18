import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ReputationTier, getTierDisplay } from '../../core/interfaces';

/**
 * Display mode for the reputation badge
 * - 'icon': Just the icon (compact)
 * - 'badge': Icon with label (standard)
 * - 'full': Icon, label, and description (detailed)
 */
export type ReputationBadgeMode = 'icon' | 'badge' | 'full';

/**
 * Reputation Badge Component
 *
 * Displays a user's reputation tier as a badge with icon, label, and description.
 * The badge is purely visual - it shows what tier a user has achieved.
 *
 * Usage:
 * <app-reputation-badge [tier]="profile.reputationTier" />
 * <app-reputation-badge [tier]="'trusted'" mode="full" />
 */
@Component({
  selector: 'app-reputation-badge',
  templateUrl: './reputation-badge.html',
  styleUrl: './reputation-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
})
export class ReputationBadgeComponent {
  /** The reputation tier to display */
  readonly tier = input.required<ReputationTier>();

  /** Display mode: 'icon', 'badge', or 'full' */
  readonly mode = input<ReputationBadgeMode>('badge');

  /** Size variant: 'small', 'medium', or 'large' */
  readonly size = input<'small' | 'medium' | 'large'>('medium');

  /** The tier display configuration */
  protected readonly tierDisplay = computed(() => getTierDisplay(this.tier()));

  /** CSS class for the badge based on tier */
  protected readonly tierClass = computed(() => `tier-${this.tier()}`);

  /** Tooltip text (shown in icon-only mode) */
  protected readonly tooltipText = computed(() => {
    const display = this.tierDisplay();
    return `${display.label}: ${display.description}`;
  });
}
