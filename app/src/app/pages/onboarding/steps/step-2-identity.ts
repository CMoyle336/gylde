import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-2-identity',
  templateUrl: './step-2-identity.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step2IdentityComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly showCustomGender = computed(
    () => this.onboarding.data().genderIdentity === 'self-describe'
  );

  protected get genderIdentity(): string {
    return this.onboarding.data().genderIdentity;
  }

  protected set genderIdentity(value: string) {
    this.onboarding.updateData({ genderIdentity: value });
  }

  protected get genderCustom(): string {
    return this.onboarding.data().genderCustom;
  }

  protected set genderCustom(value: string) {
    this.onboarding.updateData({ genderCustom: value });
  }

  protected get ageRangeMin(): number {
    return this.onboarding.data().ageRangeMin;
  }

  protected set ageRangeMin(value: number) {
    this.onboarding.updateData({ ageRangeMin: value });
  }

  protected get ageRangeMax(): number {
    return this.onboarding.data().ageRangeMax;
  }

  protected set ageRangeMax(value: number) {
    this.onboarding.updateData({ ageRangeMax: value });
  }

  protected isInterestedIn(value: string): boolean {
    return this.onboarding.data().interestedIn.includes(value);
  }

  protected toggleInterestedIn(value: string): void {
    const current = this.onboarding.data().interestedIn;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.onboarding.updateData({ interestedIn: updated });
  }
}
