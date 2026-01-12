import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { UserProfile, OnboardingProfile } from '../interfaces';

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

    // Set the first photo as the profile photo
    const profilePhotoURL = onboardingData.photos.length > 0 
      ? onboardingData.photos[0] 
      : user.photoURL;

    // Update Firebase Auth profile with the photo
    if (profilePhotoURL && profilePhotoURL !== user.photoURL) {
      await this.authService.updateUserPhoto(profilePhotoURL);
    }

    // Use setDocument with merge to handle case where profile doesn't exist yet
    const profileData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: profilePhotoURL,
      onboarding: onboardingData,
      onboardingCompleted: true,
      updatedAt: new Date(),
    };

    // If profile doesn't exist, include createdAt
    const existingProfile = this._profile();
    if (!existingProfile) {
      (profileData as UserProfile).createdAt = new Date();
    }

    await this.firestoreService.setDocument('users', user.uid, profileData, true);

    // Update local profile
    this._profile.set({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: profilePhotoURL,
      createdAt: existingProfile?.createdAt ?? new Date(),
      updatedAt: new Date(),
      onboardingCompleted: true,
      onboarding: onboardingData,
    });
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

  /**
   * Update the user's last active timestamp.
   * Should be called on login and periodically while active.
   */
  async updateLastActive(): Promise<void> {
    const user = this.authService.user();
    if (!user) return;

    try {
      const now = new Date();
      const currentProfile = this._profile();
      
      // Check if user's privacy settings allow showing last active time
      const privacy = currentProfile?.settings?.privacy;
      const showLastActive = privacy?.showLastActive !== false;
      
      // Update both lastActiveAt and sortableLastActive together
      // This prevents the onUserUpdated trigger from needing to sync them
      await this.firestoreService.updateDocument('users', user.uid, {
        lastActiveAt: now,
        sortableLastActive: showLastActive ? now : null,
      });

      // Update local profile
      if (currentProfile) {
        this._profile.set({
          ...currentProfile,
          lastActiveAt: now,
        });
      }
    } catch (error) {
      // Silently fail - this is not critical
      console.warn('Failed to update last active:', error);
    }
  }

  clearProfile(): void {
    this._profile.set(null);
  }

  /**
   * Get the current user's profile, loading it if not already loaded.
   */
  async getCurrentUserProfile(): Promise<UserProfile | null> {
    // Return cached profile if available
    const cachedProfile = this._profile();
    if (cachedProfile) {
      return cachedProfile;
    }

    // Load profile if user is authenticated
    const user = this.authService.user();
    if (user) {
      return this.loadUserProfile(user.uid);
    }

    return null;
  }
}
