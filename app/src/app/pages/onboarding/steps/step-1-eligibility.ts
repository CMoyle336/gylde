import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import { COUNTRIES } from './countries';

@Component({
  selector: 'app-step-1-eligibility',
  templateUrl: './step-1-eligibility.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step1EligibilityComponent {
  protected readonly onboarding = inject(OnboardingService);
  protected readonly countries = COUNTRIES;

  protected get isAdult(): boolean | null {
    return this.onboarding.data().isAdult;
  }

  protected set isAdult(value: boolean | null) {
    this.onboarding.updateData({ isAdult: value });
  }

  protected get city(): string {
    return this.onboarding.data().city;
  }

  protected set city(value: string) {
    this.onboarding.updateData({ city: value });
  }

  protected get country(): string {
    return this.onboarding.data().country;
  }

  protected set country(value: string) {
    this.onboarding.updateData({ country: value });
  }
}
