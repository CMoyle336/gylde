import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-3-intent',
  templateUrl: './step-3-intent.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step3IntentComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly connectionOptions = [
    { value: 'intentional-dating', labelKey: 'INTENTIONAL_DATING', descKey: 'INTENTIONAL_DATING_DESC' },
    { value: 'long-term', labelKey: 'LONG_TERM', descKey: 'LONG_TERM_DESC' },
    { value: 'mentorship', labelKey: 'MENTORSHIP', descKey: 'MENTORSHIP_DESC' },
    { value: 'lifestyle-aligned', labelKey: 'LIFESTYLE_ALIGNED', descKey: 'LIFESTYLE_ALIGNED_DESC' },
    { value: 'exploring', labelKey: 'EXPLORING', descKey: 'EXPLORING_DESC' },
  ];

  protected isSelected(value: string): boolean {
    return this.onboarding.data().connectionTypes.includes(value);
  }

  protected toggle(value: string): void {
    const current = this.onboarding.data().connectionTypes;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.onboarding.updateData({ connectionTypes: updated });
  }
}
