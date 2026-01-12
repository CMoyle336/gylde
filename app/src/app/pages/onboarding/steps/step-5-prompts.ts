import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-5-prompts',
  templateUrl: './step-5-prompts.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step5PromptsComponent {
  protected readonly onboarding = inject(OnboardingService);
  protected readonly maxIdealChars = 500;
  protected readonly maxSupportChars = 300;
  protected readonly minIdealChars = 20;

  protected readonly idealCharCount = computed(() => this.onboarding.data().idealRelationship.length);
  protected readonly supportCharCount = computed(() => this.onboarding.data().supportMeaning.length);

  protected readonly idealNearLimit = computed(
    () => this.idealCharCount() > this.maxIdealChars * 0.9
  );
  protected readonly supportNearLimit = computed(
    () => this.supportCharCount() > this.maxSupportChars * 0.9
  );

  protected get idealRelationship(): string {
    return this.onboarding.data().idealRelationship;
  }

  protected set idealRelationship(value: string) {
    if (value.length <= this.maxIdealChars) {
      this.onboarding.updateData({ idealRelationship: value });
    }
  }

  protected get supportMeaning(): string {
    return this.onboarding.data().supportMeaning;
  }

  protected set supportMeaning(value: string) {
    if (value.length <= this.maxSupportChars) {
      this.onboarding.updateData({ supportMeaning: value });
    }
  }
}
