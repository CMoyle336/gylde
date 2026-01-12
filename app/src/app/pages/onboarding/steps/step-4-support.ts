import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import { SUPPORT_ORIENTATION_OPTIONS } from '../../../core/constants/connection-types';

@Component({
  selector: 'app-step-4-support',
  templateUrl: './step-4-support.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step4SupportComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly supportOptions = SUPPORT_ORIENTATION_OPTIONS;

  protected isSelected(value: string): boolean {
    return this.onboarding.data().supportOrientation === value;
  }

  protected select(value: string): void {
    this.onboarding.updateData({ supportOrientation: value });
  }
}
