import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Date;
  updatedAt: Date;
  onboardingCompleted: boolean;
  
  // Onboarding data
  onboarding?: OnboardingProfile;
}

export interface OnboardingProfile {
  // Step 1: Eligibility
  isAdult: boolean;
  city: string;
  country: string;

  // Step 2: Dating Identity
  genderIdentity: string;
  genderCustom?: string;
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
  supportMeaning?: string;

  // Step 7: Photos
  photos: string[];

  // Step 8: Verification
  verificationOptions: string[];
}

@Injectable({
  providedIn: 'root',
})
export class UserProfileService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);

  private readonly _profile = signal<UserProfile | null>(null);
  private readonly _loading = signal(false);

  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();

  async createUserProfile(uid: string, email: string | null, displayName: string | null): Promise<void> {
    const profile: UserProfile = {
      uid,
      email,
      displayName,
      photoURL: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      onboardingCompleted: false,
    };

    await this.firestoreService.setDocument('users', uid, profile);
    this._profile.set(profile);
  }

  async loadUserProfile(uid: string): Promise<UserProfile | null> {
    this._loading.set(true);
    try {
      const profile = await this.firestoreService.getDocument<UserProfile>('users', uid);
      this._profile.set(profile);
      return profile;
    } finally {
      this._loading.set(false);
    }
  }

  async saveOnboardingData(onboardingData: OnboardingProfile): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      throw new Error('User not authenticated');
    }

    await this.firestoreService.updateDocument('users', user.uid, {
      onboarding: onboardingData,
      onboardingCompleted: true,
      updatedAt: new Date(),
    });

    // Update local profile
    const currentProfile = this._profile();
    if (currentProfile) {
      this._profile.set({
        ...currentProfile,
        onboarding: onboardingData,
        onboardingCompleted: true,
        updatedAt: new Date(),
      });
    }
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      throw new Error('User not authenticated');
    }

    await this.firestoreService.updateDocument('users', user.uid, {
      ...updates,
      updatedAt: new Date(),
    });

    const currentProfile = this._profile();
    if (currentProfile) {
      this._profile.set({
        ...currentProfile,
        ...updates,
        updatedAt: new Date(),
      });
    }
  }

  isOnboardingCompleted(): boolean {
    return this._profile()?.onboardingCompleted ?? false;
  }

  clearProfile(): void {
    this._profile.set(null);
  }
}
