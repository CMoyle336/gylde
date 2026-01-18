import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DiscoveryFilters } from '../../../../core/interfaces';
import { 
  RELATIONSHIP_GOALS, 
  RELATIONSHIP_STYLE, 
  LIFESTYLE_PREFERENCES 
} from '../../../../core/constants/connection-types';

export interface FilterOption {
  label: string;
  value: string;
}

export interface DistanceOption {
  label: string;
  value: number | null;
}

export interface ReputationTierOption {
  label: string;
  value: string | null;
}


@Component({
  selector: 'app-discover-filters',
  templateUrl: './discover-filters.html',
  styleUrl: './discover-filters.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
  ],
})
export class DiscoverFiltersComponent {
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
}
