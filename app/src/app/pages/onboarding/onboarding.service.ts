import { Injectable, signal, computed } from '@angular/core';
import { OnboardingData } from './onboarding.interface';

const INITIAL_DATA: OnboardingData = {
  birthDate: null,
  city: '',
  country: '',
  location: null,
  genderIdentity: '',
  genderCustom: '',
  interestedIn: [],
  ageRangeMin: 18,
  ageRangeMax: 65,
  connectionTypes: [],
  supportOrientation: '',
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

  readonly totalSteps = 7;
  readonly currentStep = this._currentStep.asReadonly();
  readonly data = this._data.asReadonly();

  readonly progress = computed(() => (this._currentStep() / this.totalSteps) * 100);

  readonly canProceed = computed(() => {
    const step = this._currentStep();
    const data = this._data();

    switch (step) {
      case 1:
        // User must be 18+ and have location set
        // City contains the full location string (e.g., "Ypsilanti, Michigan, USA")
        // Location must have coordinates for distance matching
        const isAdult = data.birthDate ? this.calculateAge(data.birthDate) >= 18 : false;
        return isAdult && data.city.trim() !== '' && data.location !== null;
      case 2:
        return data.genderIdentity !== '' && data.interestedIn.length > 0;
      case 3:
        return data.connectionTypes.length > 0;
      case 4:
        return true; // Optional step
      case 5:
        return data.idealRelationship.trim().length >= 20;
      case 6:
        return data.photos.length >= 1;
      case 7:
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

  /**
   * Calculate age from birth date string
   */
  calculateAge(birthDate: string): number {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age;
  }
}
