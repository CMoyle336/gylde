import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { UserProfileService } from '../../core/services/user-profile.service';
import { OnboardingProfile, Photo } from '../../core/interfaces';
import { OnboardingService } from './onboarding.service';
import { Step1EligibilityComponent } from './steps/step-1-eligibility';
import { Step2IdentityComponent } from './steps/step-2-identity';
import { Step3IntentComponent } from './steps/step-3-intent';
import { Step4SupportComponent } from './steps/step-4-support';
import { Step5PromptsComponent } from './steps/step-5-prompts';
import { Step6PhotosComponent } from './steps/step-6-photos';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    Step1EligibilityComponent,
    Step2IdentityComponent,
    Step3IntentComponent,
    Step4SupportComponent,
    Step5PromptsComponent,
    Step6PhotosComponent,
  ],
})
export class OnboardingComponent {
  private readonly router = inject(Router);
  private readonly userProfileService = inject(UserProfileService);
  protected readonly onboarding = inject(OnboardingService);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected onNext(): void {
    if (this.onboarding.currentStep() === this.onboarding.totalSteps) {
      this.completeOnboarding();
    } else {
      this.onboarding.nextStep();
    }
  }

  protected onBack(): void {
    if (this.onboarding.currentStep() === 1) {
      this.router.navigate(['/']);
    } else {
      this.onboarding.previousStep();
    }
  }

  protected onSkip(): void {
    this.onboarding.nextStep();
  }

  private async completeOnboarding(): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);

    try {
      const data = this.onboarding.data();
      
      // Map onboarding data to profile structure
      // Note: Don't include undefined values - Firestore doesn't support them
      const onboardingProfile: OnboardingProfile = {
        birthDate: data.birthDate || '',
        city: data.city,
        country: data.country,
        genderIdentity: data.genderIdentity,
        interestedIn: data.interestedIn,
        ageRangeMin: data.ageRangeMin,
        ageRangeMax: data.ageRangeMax,
        connectionTypes: data.connectionTypes,
        supportOrientation: data.supportOrientation,
        idealRelationship: data.idealRelationship,
        photoDetails: data.photos.map((url, index): Photo => ({
          id: `photo-${Date.now()}-${index}`,
          url,
          isPrivate: false,
          uploadedAt: new Date(),
          order: index,
        })),
        verificationOptions: [],
      };

      // Only add optional fields if they have values
      if (data.genderCustom) {
        onboardingProfile.genderCustom = data.genderCustom;
      }
      if (data.supportMeaning) {
        onboardingProfile.supportMeaning = data.supportMeaning;
      }
      if (data.location) {
        onboardingProfile.location = data.location;
      }

      console.log('Saving onboarding data:', onboardingProfile);
      await this.userProfileService.saveOnboardingData(onboardingProfile);
      console.log('Onboarding data saved successfully');
      
      // Reset onboarding state and navigate to discover
      this.onboarding.reset();
      this.router.navigate(['/discover']);
    } catch (error: unknown) {
      console.error('Failed to save onboarding data:', error);
      
      // Extract more useful error message
      let errorMessage = 'Failed to save your profile. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null && 'code' in error) {
        errorMessage = `Firebase error: ${(error as { code: string }).code}`;
      }
      
      this.saveError.set(errorMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
