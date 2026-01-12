import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import {
  RELATIONSHIP_GOALS,
  RELATIONSHIP_STYLE,
  LIFESTYLE_PREFERENCES,
} from '../../../core/constants/connection-types';

@Component({
  selector: 'app-step-3-intent',
  templateUrl: './step-3-intent.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step3IntentComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly goalOptions = RELATIONSHIP_GOALS;
  protected readonly styleOptions = RELATIONSHIP_STYLE;
  protected readonly lifestylePreferenceOptions = LIFESTYLE_PREFERENCES;

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
