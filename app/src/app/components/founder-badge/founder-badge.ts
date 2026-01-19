import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Founder Badge Component
 *
 * Displays a "Founder" badge for users who were among the first 50 members
 * of their city/region. The badge is a special recognition that cannot be
 * earned later.
 *
 * Usage:
 * <app-founder-badge />
 * <app-founder-badge [city]="user.founderCity" />
 */
@Component({
  selector: 'app-founder-badge',
  templateUrl: './founder-badge.html',
  styleUrl: './founder-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
})
export class FounderBadgeComponent {
  /** Optional: The city the user is a founder for */
  readonly city = input<string | undefined>(undefined);

  /** Size variant: 'small', 'medium', or 'large' */
  readonly size = input<'small' | 'medium' | 'large'>('medium');

  /** Whether to show just the icon or the full badge with label */
  readonly iconOnly = input<boolean>(false);
}
