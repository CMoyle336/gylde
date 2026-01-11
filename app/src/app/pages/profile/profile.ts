import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserProfileService } from '../../core/services/user-profile.service';
import { StorageService } from '../../core/services/storage.service';
import { AuthService } from '../../core/services/auth.service';
import { OnboardingProfile } from '../../core/interfaces';

interface EditForm {
  genderIdentity: string;
  interestedIn: string[];
  ageRangeMin: number;
  ageRangeMax: number;
  connectionTypes: string[];
  idealRelationship: string;
  supportMeaning: string;
  // Secondary profile info
  height: string;
  weight: string;
  ethnicity: string;
  relationshipStatus: string;
  children: string;
  smoker: string;
  drinker: string;
  education: string;
  occupation: string;
}

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  styleUrl: './profile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
})
export class ProfileComponent implements OnInit {
  private readonly userProfileService = inject(UserProfileService);
  private readonly storageService = inject(StorageService);
  private readonly authService = inject(AuthService);

  @ViewChild('photoInput') photoInput!: ElementRef<HTMLInputElement>;

  protected readonly profile = this.userProfileService.profile;
  protected readonly isEditing = signal(false);
  protected readonly saving = signal(false);

  // Editable photos list (writable for immediate UI updates)
  protected readonly editablePhotos = signal<string[]>([]);

  // Current profile photo URL (writable for immediate updates)
  protected readonly profilePhotoUrl = signal<string | null>(null);

  constructor() {
    // Sync photos from profile when not editing
    effect(() => {
      const profile = this.profile();
      if (profile && !this.isEditing()) {
        this.editablePhotos.set([...(profile.onboarding?.photos || [])]);
        this.profilePhotoUrl.set(profile.photoURL || null);
      }
    });
  }

  ngOnInit(): void {
    // Initial sync
    const profile = this.profile();
    if (profile) {
      this.editablePhotos.set([...(profile.onboarding?.photos || [])]);
      this.profilePhotoUrl.set(profile.photoURL || null);
    }
  }

  // Edit form data
  protected editForm: EditForm = {
    genderIdentity: '',
    interestedIn: [],
    ageRangeMin: 18,
    ageRangeMax: 99,
    connectionTypes: [],
    idealRelationship: '',
    supportMeaning: '',
    height: '',
    weight: '',
    ethnicity: '',
    relationshipStatus: '',
    children: '',
    smoker: '',
    drinker: '',
    education: '',
    occupation: '',
  };

  // Options for secondary profile fields
  protected readonly ethnicityOptions = [
    'Asian', 'Black/African', 'Hispanic/Latino', 'Middle Eastern',
    'Native American', 'Pacific Islander', 'White/Caucasian', 'Mixed', 'Other', 'Prefer not to say'
  ];

  protected readonly relationshipStatusOptions = [
    'Single', 'Divorced', 'Separated', 'Widowed', 'In a relationship', 'Married', 'Prefer not to say'
  ];

  protected readonly childrenOptions = [
    'No children', 'Have children', 'Want children', 'Don\'t want children', 'Open to children', 'Prefer not to say'
  ];

  protected readonly smokerOptions = [
    'Never', 'Occasionally', 'Socially', 'Regularly', 'Trying to quit', 'Prefer not to say'
  ];

  protected readonly drinkerOptions = [
    'Never', 'Occasionally', 'Socially', 'Regularly', 'Prefer not to say'
  ];

  protected readonly educationOptions = [
    'High school', 'Some college', 'Associate degree', 'Bachelor\'s degree',
    'Master\'s degree', 'Doctorate', 'Trade school', 'Prefer not to say'
  ];

  // Options for form fields (values must match onboarding data)
  protected readonly genderOptions = [
    { value: 'women', label: 'Women' },
    { value: 'men', label: 'Men' },
    { value: 'nonbinary', label: 'Non-binary' },
  ];

  protected readonly connectionTypeOptions = [
    { value: 'intentional-dating', label: 'Intentional Dating' },
    { value: 'long-term', label: 'Long-term Relationship' },
    { value: 'mentorship', label: 'Mentorship' },
    { value: 'lifestyle-aligned', label: 'Lifestyle Aligned' },
    { value: 'exploring', label: 'Exploring' },
  ];

  startEditing(): void {
    const profile = this.profile();
    if (!profile) return;

    // Initialize form with current values
    this.editForm = {
      genderIdentity: profile.onboarding?.genderIdentity || '',
      interestedIn: [...(profile.onboarding?.interestedIn || [])],
      ageRangeMin: profile.onboarding?.ageRangeMin || 18,
      ageRangeMax: profile.onboarding?.ageRangeMax || 99,
      connectionTypes: [...(profile.onboarding?.connectionTypes || [])],
      idealRelationship: profile.onboarding?.idealRelationship || '',
      supportMeaning: profile.onboarding?.supportMeaning || '',
      height: profile.onboarding?.height || '',
      weight: profile.onboarding?.weight || '',
      ethnicity: profile.onboarding?.ethnicity || '',
      relationshipStatus: profile.onboarding?.relationshipStatus || '',
      children: profile.onboarding?.children || '',
      smoker: profile.onboarding?.smoker || '',
      drinker: profile.onboarding?.drinker || '',
      education: profile.onboarding?.education || '',
      occupation: profile.onboarding?.occupation || '',
    };

    // Photos are already synced via effect
    this.isEditing.set(true);
  }

  cancelEditing(): void {
    // Reset to original values from profile
    const profile = this.profile();
    if (profile) {
      this.editablePhotos.set([...(profile.onboarding?.photos || [])]);
      this.profilePhotoUrl.set(profile.photoURL || null);
    }
    this.isEditing.set(false);
  }

  async saveProfile(): Promise<void> {
    const profile = this.profile();
    if (!profile || !profile.onboarding) return;

    this.saving.set(true);

    try {
      const photos = this.editablePhotos();
      const profilePhoto = this.profilePhotoUrl() || photos[0] || null;

      // Build updated onboarding data
      const updatedOnboarding: Partial<OnboardingProfile> = {
        ...profile.onboarding,
        genderIdentity: this.editForm.genderIdentity,
        interestedIn: this.editForm.interestedIn,
        ageRangeMin: this.editForm.ageRangeMin,
        ageRangeMax: this.editForm.ageRangeMax,
        connectionTypes: this.editForm.connectionTypes,
        idealRelationship: this.editForm.idealRelationship,
        supportMeaning: this.editForm.supportMeaning,
        photos: photos,
      };

      // Only add secondary fields if they have values
      if (this.editForm.height) updatedOnboarding.height = this.editForm.height;
      if (this.editForm.weight) updatedOnboarding.weight = this.editForm.weight;
      if (this.editForm.ethnicity) updatedOnboarding.ethnicity = this.editForm.ethnicity;
      if (this.editForm.relationshipStatus) updatedOnboarding.relationshipStatus = this.editForm.relationshipStatus;
      if (this.editForm.children) updatedOnboarding.children = this.editForm.children;
      if (this.editForm.smoker) updatedOnboarding.smoker = this.editForm.smoker;
      if (this.editForm.drinker) updatedOnboarding.drinker = this.editForm.drinker;
      if (this.editForm.education) updatedOnboarding.education = this.editForm.education;
      if (this.editForm.occupation) updatedOnboarding.occupation = this.editForm.occupation;

      // Update profile
      await this.userProfileService.updateProfile({
        photoURL: profilePhoto,
        onboarding: updatedOnboarding as OnboardingProfile,
      });

      // Update Firebase Auth photo if changed
      if (profilePhoto !== profile.photoURL) {
        await this.authService.updateUserPhoto(profilePhoto || '');
      }

      this.isEditing.set(false);
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      this.saving.set(false);
    }
  }

  // Photo management
  openPhotoPicker(): void {
    this.photoInput.nativeElement.click();
  }

  async onPhotosSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const user = this.authService.user();
    if (!user) return;

    this.saving.set(true);

    try {
      const currentPhotos = this.editablePhotos();
      const newPhotos = [...currentPhotos];

      for (const file of Array.from(files)) {
        if (newPhotos.length >= 6) break;

        const path = this.storageService.generateFilePath(user.uid, 'photos', file.name);
        const url = await this.storageService.uploadFile(path, file);
        newPhotos.push(url);
      }

      this.editablePhotos.set(newPhotos);

      // If not editing, save immediately
      if (!this.isEditing()) {
        await this.savePhotosToProfile();
      }
    } catch (error) {
      console.error('Error uploading photos:', error);
    } finally {
      this.saving.set(false);
      input.value = ''; // Reset input
    }
  }

  async removePhoto(index: number): Promise<void> {
    const photos = this.editablePhotos();
    const photoUrl = photos[index];
    const newPhotos = photos.filter((_, i) => i !== index);
    this.editablePhotos.set(newPhotos);

    // If removed photo was profile photo, set first remaining photo as profile
    if (photoUrl === this.profilePhotoUrl()) {
      this.profilePhotoUrl.set(newPhotos[0] || null);
    }

    // If not editing, save immediately
    if (!this.isEditing()) {
      await this.savePhotosToProfile();
    }
  }

  async setAsProfilePhoto(photoUrl: string): Promise<void> {
    this.profilePhotoUrl.set(photoUrl);

    // If not editing, save immediately
    if (!this.isEditing()) {
      await this.updateProfilePhoto(photoUrl);
    }
  }

  private async savePhotosToProfile(): Promise<void> {
    const profile = this.profile();
    if (!profile || !profile.onboarding) return;

    const photos = this.editablePhotos();
    const newProfilePhoto = this.profilePhotoUrl() || photos[0] || null;

    await this.userProfileService.updateProfile({
      photoURL: newProfilePhoto,
      onboarding: {
        ...profile.onboarding,
        photos: photos,
      },
    });

    if (newProfilePhoto !== profile.photoURL) {
      await this.authService.updateUserPhoto(newProfilePhoto || '');
    }
  }

  private async updateProfilePhoto(photoUrl: string): Promise<void> {
    await this.userProfileService.updateProfile({
      photoURL: photoUrl,
    });
    await this.authService.updateUserPhoto(photoUrl);
  }

  // Toggle helpers
  toggleInterest(value: string): void {
    const index = this.editForm.interestedIn.indexOf(value);
    if (index === -1) {
      this.editForm.interestedIn.push(value);
    } else {
      this.editForm.interestedIn.splice(index, 1);
    }
  }

  toggleConnectionType(value: string): void {
    const index = this.editForm.connectionTypes.indexOf(value);
    if (index === -1) {
      this.editForm.connectionTypes.push(value);
    } else {
      this.editForm.connectionTypes.splice(index, 1);
    }
  }

  // Formatting helpers
  formatBirthDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  calculateAge(dateStr: string): number {
    const today = new Date();
    const birthDate = new Date(dateStr);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  formatGender(gender?: string): string {
    if (!gender) return 'Not set';
    return gender.charAt(0).toUpperCase() + gender.slice(1);
  }

  formatInterests(interests?: string[]): string {
    if (!interests || interests.length === 0) return 'Not set';
    return interests.map(i => this.formatGender(i)).join(', ');
  }

  formatConnectionTypes(types?: string[]): string {
    if (!types || types.length === 0) return 'Not set';
    const labels: Record<string, string> = {
      'intentional-dating': 'Intentional Dating',
      'long-term': 'Long-term Relationship',
      'mentorship': 'Mentorship',
      'lifestyle-aligned': 'Lifestyle Aligned',
      'exploring': 'Exploring',
    };
    return types.map(t => labels[t] || t).join(', ');
  }
}
