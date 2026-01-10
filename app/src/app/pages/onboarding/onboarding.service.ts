import { Injectable, signal, computed } from '@angular/core';

export interface OnboardingData {
  // Step 1: Eligibility
  isAdult: boolean | null;
  city: string;
  country: string;

  // Step 2: Dating Identity
  genderIdentity: string;
  genderCustom: string;
  interestedIn: string[];
  ageRangeMin: number;
  ageRangeMax: number;

  // Step 3: Relationship Intent
  connectionTypes: string[];

  // Step 4: Support Orientation
  supportOrientation: string[];

  // Step 5: Values & Lifestyle
  values: string[];
  lifestyle: string;

  // Step 6: Open-Ended Prompts
  idealRelationship: string;
  supportMeaning: string;

  // Step 7: Photos
  photos: string[];

  // Step 8: Verification
  verificationOptions: string[];
}

const INITIAL_DATA: OnboardingData = {
  isAdult: null,
  city: '',
  country: '',
  genderIdentity: '',
  genderCustom: '',
  interestedIn: [],
  ageRangeMin: 18,
  ageRangeMax: 65,
  connectionTypes: [],
  supportOrientation: [],
  values: [],
  lifestyle: '',
  idealRelationship: '',
  supportMeaning: '',
  photos: [],
  verificationOptions: [],
};

@Injectable({
  providedIn: 'root',
})
export class OnboardingService {
  private readonly _currentStep = signal(1);
  private readonly _data = signal<OnboardingData>({ ...INITIAL_DATA });

  readonly totalSteps = 8;
  readonly currentStep = this._currentStep.asReadonly();
  readonly data = this._data.asReadonly();

  readonly progress = computed(() => (this._currentStep() / this.totalSteps) * 100);

  readonly canProceed = computed(() => {
    const step = this._currentStep();
    const data = this._data();

    switch (step) {
      case 1:
        return data.isAdult === true && data.city.trim() !== '' && data.country !== '';
      case 2:
        return data.genderIdentity !== '' && data.interestedIn.length > 0;
      case 3:
        return data.connectionTypes.length > 0;
      case 4:
        return true; // Optional step
      case 5:
        return data.values.length > 0 && data.lifestyle !== '';
      case 6:
        return data.idealRelationship.trim().length >= 20;
      case 7:
        return data.photos.length >= 1;
      case 8:
        return true; // Optional step
      default:
        return false;
    }
  });

  updateData(partial: Partial<OnboardingData>): void {
    this._data.update((current) => ({ ...current, ...partial }));
  }

  nextStep(): void {
    if (this._currentStep() < this.totalSteps) {
      this._currentStep.update((s) => s + 1);
    }
  }

  previousStep(): void {
    if (this._currentStep() > 1) {
      this._currentStep.update((s) => s - 1);
    }
  }

  goToStep(step: number): void {
    if (step >= 1 && step <= this.totalSteps) {
      this._currentStep.set(step);
    }
  }

  reset(): void {
    this._currentStep.set(1);
    this._data.set({ ...INITIAL_DATA });
  }
}
