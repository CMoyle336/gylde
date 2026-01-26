import { ChangeDetectionStrategy, Component, inject, input, output, signal, computed } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { DiscoveryFilters } from '../../../../core/interfaces';
import { 
  RELATIONSHIP_GOALS, 
  RELATIONSHIP_STYLE, 
  LIFESTYLE_PREFERENCES 
} from '../../../../core/constants/connection-types';
import { SubscriptionService } from '../../../../core/services/subscription.service';

export interface FilterOption {
  label: string;
  value: string;
}

export interface DistanceOption {
  labelKey: string;
  labelParams?: Record<string, unknown>;
  value: number | null;
}

export interface ReputationTierOption {
  labelKey: string;
  value: string | null;
}

// Tier display configuration for the visual selector
const TIER_VISUAL_CONFIG: Record<string, { icon: string; color: string; descriptionKey: string }> = {
  active: {
    icon: 'trending_up',
    color: '#3b82f6', // blue-500
    descriptionKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS_DESC.ACTIVE_PLUS',
  },
  established: {
    icon: 'star_half',
    color: '#c9a962', // brand gold
    descriptionKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS_DESC.ESTABLISHED_PLUS',
  },
  trusted: {
    icon: 'star',
    color: '#f59e0b', // amber-500
    descriptionKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS_DESC.TRUSTED_PLUS',
  },
};


@Component({
  selector: 'app-discover-filters',
  templateUrl: './discover-filters.html',
  styleUrl: './discover-filters.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslateModule,
  ],
})
export class DiscoverFiltersComponent {
  private readonly subscriptionService = inject(SubscriptionService);

  // Premium status
  protected readonly isPremium = this.subscriptionService.isPremium;

  // Inputs
  readonly filters = input.required<DiscoveryFilters>();
  readonly connectionTypeOptions = input.required<FilterOption[]>();
  readonly ethnicityOptions = input.required<string[]>();
  readonly relationshipStatusOptions = input.required<string[]>();
  readonly childrenOptions = input.required<string[]>();
  readonly smokerOptions = input.required<string[]>();
  readonly drinkerOptions = input.required<string[]>();
  readonly educationOptions = input.required<string[]>();
  readonly heightOptions = input.required<string[]>();
  readonly incomeOptions = input.required<string[]>();
  readonly supportOrientationOptions = input.required<FilterOption[]>();
  readonly distanceOptions = input.required<DistanceOption[]>();
  readonly reputationTierOptions = input.required<ReputationTierOption[]>();

  // Connection type groups for organized display
  protected readonly relationshipGoals = () => RELATIONSHIP_GOALS;
  protected readonly relationshipStyle = () => RELATIONSHIP_STYLE;
  protected readonly lifestylePreferences = () => LIFESTYLE_PREFERENCES;

  // Outputs
  readonly filterChange = output<{ key: keyof DiscoveryFilters; value: unknown }>();
  readonly reset = output<void>();
  readonly apply = output<void>();

  // Local state
  protected readonly showAdvancedFilters = signal(false);

  protected toggleAdvancedFilters(): void {
    // If not premium and trying to open, show upgrade prompt
    if (!this.isPremium() && !this.showAdvancedFilters()) {
      this.subscriptionService.showUpgradePrompt('advancedFilters');
      return;
    }
    this.showAdvancedFilters.update(v => !v);
  }

  protected updateFilter(key: keyof DiscoveryFilters, value: unknown): void {
    this.filterChange.emit({ key, value });
  }

  protected toggleArrayFilter(key: keyof DiscoveryFilters, value: string): void {
    const currentArray = (this.filters()[key] as string[]) || [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    this.filterChange.emit({ key, value: newArray });
  }

  protected isFilterSelected(key: keyof DiscoveryFilters, value: string): boolean {
    const currentArray = (this.filters()[key] as string[]) || [];
    return currentArray.includes(value);
  }

  protected onReset(): void {
    this.reset.emit();
  }

  protected onApply(): void {
    this.apply.emit();
  }

  // Reputation tier selector helpers
  protected readonly tierVisualOptions = [
    { value: null, labelKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS.ALL', icon: 'people', color: 'var(--color-text-muted)', descriptionKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS_DESC.ALL' },
    { value: 'active', labelKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS.ACTIVE_PLUS', ...TIER_VISUAL_CONFIG['active'] },
    { value: 'established', labelKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS.ESTABLISHED_PLUS', ...TIER_VISUAL_CONFIG['established'] },
    { value: 'trusted', labelKey: 'DISCOVER.FILTER_PANEL.REPUTATION_TIERS.TRUSTED_PLUS', ...TIER_VISUAL_CONFIG['trusted'] },
  ];

  protected isReputationTierSelected(value: string | null): boolean {
    return this.filters().minReputationTier === value;
  }

  protected selectReputationTier(value: string | null): void {
    this.updateFilter('minReputationTier', value);
  }
}
