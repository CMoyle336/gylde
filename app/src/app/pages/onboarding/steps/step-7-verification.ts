import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-7-verification',
  templateUrl: './step-7-verification.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step7VerificationComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly verificationOptions = [
    { value: 'identity', labelKey: 'IDENTITY_VERIFY', descKey: 'IDENTITY_VERIFY_DESC', icon: 'badge' },
    { value: 'photo', labelKey: 'PHOTO_VERIFY', descKey: 'PHOTO_VERIFY_DESC', icon: 'photo_camera' },
  ];

  protected readonly benefits = [
    'BENEFIT_1',
    'BENEFIT_2',
    'BENEFIT_3',
    'BENEFIT_4',
  ];

  protected isSelected(value: string): boolean {
    return this.onboarding.data().verificationOptions.includes(value);
  }

  protected toggle(value: string): void {
    const current = this.onboarding.data().verificationOptions;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.onboarding.updateData({ verificationOptions: updated });
  }
}
