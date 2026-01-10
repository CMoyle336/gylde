import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-5-values',
  templateUrl: './step-5-values.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step5ValuesComponent {
  protected readonly onboarding = inject(OnboardingService);
  protected readonly maxValues = 3;

  protected readonly valueOptions = [
    { value: 'ambition', labelKey: 'VALUE_AMBITION', icon: 'trending_up' },
    { value: 'generosity', labelKey: 'VALUE_GENEROSITY', icon: 'volunteer_activism' },
    { value: 'independence', labelKey: 'VALUE_INDEPENDENCE', icon: 'self_improvement' },
    { value: 'emotional-maturity', labelKey: 'VALUE_EMOTIONAL_MATURITY', icon: 'psychology' },
    { value: 'growth', labelKey: 'VALUE_GROWTH', icon: 'eco' },
    { value: 'stability', labelKey: 'VALUE_STABILITY', icon: 'balance' },
    { value: 'adventure', labelKey: 'VALUE_ADVENTURE', icon: 'explore' },
  ];

  protected readonly lifestyleOptions = [
    { value: 'very-flexible', labelKey: 'LIFESTYLE_VERY_FLEXIBLE' },
    { value: 'somewhat-flexible', labelKey: 'LIFESTYLE_SOMEWHAT_FLEXIBLE' },
    { value: 'structured', labelKey: 'LIFESTYLE_STRUCTURED' },
    { value: 'highly-demanding', labelKey: 'LIFESTYLE_HIGHLY_DEMANDING' },
  ];

  protected readonly selectedCount = computed(() => this.onboarding.data().values.length);

  protected get lifestyle(): string {
    return this.onboarding.data().lifestyle;
  }

  protected set lifestyle(value: string) {
    this.onboarding.updateData({ lifestyle: value });
  }

  protected isValueSelected(value: string): boolean {
    return this.onboarding.data().values.includes(value);
  }

  protected toggleValue(value: string): void {
    const current = this.onboarding.data().values;
    
    if (current.includes(value)) {
      this.onboarding.updateData({ values: current.filter((v) => v !== value) });
    } else if (current.length < this.maxValues) {
      this.onboarding.updateData({ values: [...current, value] });
    }
  }

  protected canSelectMore(): boolean {
    return this.onboarding.data().values.length < this.maxValues;
  }
}
