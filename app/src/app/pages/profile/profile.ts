import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, effect, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { AuthService } from '../../core/services/auth.service';
import { PhotoAccessService } from '../../core/services/photo-access.service';
import { OnboardingProfile } from '../../core/interfaces';
import { Photo } from '../../core/interfaces/photo.interface';
import { ALL_CONNECTION_TYPES, getConnectionTypeLabel, SUPPORT_ORIENTATION_OPTIONS, getSupportOrientationLabel } from '../../core/constants/connection-types';
import { MAX_PHOTOS_PER_USER } from '../../core/constants/app-config';
import { PhotoAccessDialogComponent } from '../../components/photo-access-dialog';

interface EditForm {
  // Basic info
  displayName: string;
  city: string;
  // Dating preferences
  genderIdentity: string;
  interestedIn: string[];
  ageRangeMin: number;
  ageRangeMax: number;
  connectionTypes: string[];
  supportOrientation: string;
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

interface UploadingPhoto {
  id: string;
  preview: string;
  status: 'uploading' | 'success' | 'error';
  error?: string;
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
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly authService = inject(AuthService);
  private readonly photoAccessService = inject(PhotoAccessService);
  private readonly dialog = inject(MatDialog);

  protected readonly uploadError = signal<string | null>(null);

  @ViewChild('photoInput') photoInput!: ElementRef<HTMLInputElement>;

  protected readonly profile = this.userProfileService.profile;
  protected readonly isEditing = signal(false);
  protected readonly saving = signal(false);

  // Editable photos list (writable for immediate UI updates)
  protected readonly editablePhotos = signal<string[]>([]);

  // Photos currently being uploaded (with preview)
  protected readonly uploadingPhotos = signal<UploadingPhoto[]>([]);

  // Current profile photo URL (writable for immediate updates)
  protected readonly profilePhotoUrl = signal<string | null>(null);

  // Photo privacy state (map of url -> isPrivate)
  protected readonly photoPrivacy = signal<Map<string, boolean>>(new Map());

  // Pending requests count (for badge)
  protected readonly pendingRequestsCount = this.photoAccessService.pendingRequestsCount;

  // Max photos allowed
  protected readonly maxPhotos = MAX_PHOTOS_PER_USER;

  // Check if user has any private photos
  protected readonly hasPrivatePhotos = computed(() => {
    const privacyMap = this.photoPrivacy();
    return Array.from(privacyMap.values()).some(isPrivate => isPrivate);
  });

  // Computed: photos with their privacy status
  protected readonly photosWithPrivacy = computed(() => {
    const photos = this.editablePhotos();
    const privacyMap = this.photoPrivacy();
    const profilePhoto = this.profilePhotoUrl();
    
    return photos.map(url => ({
      url,
      isPrivate: privacyMap.get(url) || false,
      isProfilePhoto: url === profilePhoto,
    }));
  });

  constructor() {
    // Sync photos from profile when not editing
    effect(() => {
      const profile = this.profile();
      if (profile && !this.isEditing()) {
        this.editablePhotos.set([...(profile.onboarding?.photos || [])]);
        this.profilePhotoUrl.set(profile.photoURL || null);
        
        // Sync photo privacy state
        const photoDetails = profile.onboarding?.photoDetails || [];
        const privacyMap = new Map<string, boolean>();
        for (const detail of photoDetails as Photo[]) {
          privacyMap.set(detail.url, detail.isPrivate);
        }
        this.photoPrivacy.set(privacyMap);
      }
    });
  }

  ngOnInit(): void {
    // Initial sync
    const profile = this.profile();
    if (profile) {
      this.editablePhotos.set([...(profile.onboarding?.photos || [])]);
      this.profilePhotoUrl.set(profile.photoURL || null);
      
      // Sync photo privacy state
      const photoDetails = profile.onboarding?.photoDetails || [];
      const privacyMap = new Map<string, boolean>();
      for (const detail of photoDetails as Photo[]) {
        privacyMap.set(detail.url, detail.isPrivate);
      }
      this.photoPrivacy.set(privacyMap);
    }
  }

  // Edit form data
  protected editForm: EditForm = {
    displayName: '',
    city: '',
    genderIdentity: '',
    interestedIn: [],
    ageRangeMin: 18,
    ageRangeMax: 99,
    connectionTypes: [],
    supportOrientation: '',
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

  protected readonly connectionTypeOptions = ALL_CONNECTION_TYPES;

  protected readonly supportOrientationOptions = SUPPORT_ORIENTATION_OPTIONS;

  startEditing(): void {
    const profile = this.profile();
    if (!profile) return;

    // Initialize form with current values
    this.editForm = {
      displayName: profile.displayName || '',
      city: profile.onboarding?.city ? `${profile.onboarding.city}, ${profile.onboarding.country || ''}`.trim() : '',
      genderIdentity: profile.onboarding?.genderIdentity || '',
      interestedIn: [...(profile.onboarding?.interestedIn || [])],
      ageRangeMin: profile.onboarding?.ageRangeMin || 18,
      ageRangeMax: profile.onboarding?.ageRangeMax || 99,
      connectionTypes: [...(profile.onboarding?.connectionTypes || [])],
      supportOrientation: profile.onboarding?.supportOrientation || '',
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

      // Parse city/country from combined input
      const locationParts = this.editForm.city.split(',').map(s => s.trim());
      const city = locationParts[0] || '';
      const country = locationParts.slice(1).join(', ') || profile.onboarding.country || '';

      // Build updated onboarding data
      const updatedOnboarding: Partial<OnboardingProfile> = {
        ...profile.onboarding,
        city,
        country,
        genderIdentity: this.editForm.genderIdentity,
        interestedIn: this.editForm.interestedIn,
        ageRangeMin: this.editForm.ageRangeMin,
        ageRangeMax: this.editForm.ageRangeMax,
        connectionTypes: this.editForm.connectionTypes,
        supportOrientation: this.editForm.supportOrientation,
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

      // Update profile (including displayName at the root level)
      await this.userProfileService.updateProfile({
        displayName: this.editForm.displayName || profile.displayName,
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

    // Clear previous error
    this.uploadError.set(null);

    const currentPhotos = this.editablePhotos();
    const currentUploading = this.uploadingPhotos().length;
    const availableSlots = this.maxPhotos - currentPhotos.length - currentUploading;
    
    // Check if user can upload more photos
    if (availableSlots <= 0) {
      this.uploadError.set(`Maximum of ${this.maxPhotos} photos allowed`);
      input.value = '';
      return;
    }

    // Get files to upload (limited by available slots)
    const filesToUpload = Array.from(files).slice(0, availableSlots);
    
    if (filesToUpload.length < files.length) {
      this.uploadError.set(`Only ${availableSlots} more photo(s) can be added. Maximum is ${this.maxPhotos}.`);
    }

    // Validate all files FIRST before any processing
    for (const file of filesToUpload) {
      const validation = this.imageUploadService.validateFile(file);
      if (!validation.valid) {
        this.uploadError.set(validation.error || 'Invalid file');
        input.value = '';
        return;
      }
    }

    // Reset input immediately so user can select more files
    input.value = '';

    // Create previews and add to uploading list
    const uploadingItems: UploadingPhoto[] = [];
    for (const file of filesToUpload) {
      const preview = await this.imageUploadService.createPreview(file);
      const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      uploadingItems.push({ id, preview, status: 'uploading' });
    }
    
    // Add all uploading items to the signal
    this.uploadingPhotos.set([...this.uploadingPhotos(), ...uploadingItems]);

    // Upload each file individually and update status
    const successfulUrls: string[] = [];
    
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const uploadingItem = uploadingItems[i];
      
      try {
        const result = await this.imageUploadService.uploadImage(file, 'photos');
        
        if (result.success && result.url) {
          successfulUrls.push(result.url);
          
          // Remove from uploading list BEFORE adding to editable photos
          this.removeUploadingPhoto(uploadingItem.id);
          
          // Add to editable photos
          this.editablePhotos.set([...this.editablePhotos(), result.url]);
        } else {
          this.updateUploadingPhotoStatus(uploadingItem.id, 'error', result.error);
          // Remove failed upload after showing error briefly
          setTimeout(() => this.removeUploadingPhoto(uploadingItem.id), 3000);
        }
      } catch (error) {
        console.error('Error uploading photo:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        this.updateUploadingPhotoStatus(uploadingItem.id, 'error', errorMessage);
        // Remove failed upload after showing error briefly
        setTimeout(() => this.removeUploadingPhoto(uploadingItem.id), 3000);
      }
    }

    // Save to profile if we had any successful uploads and not in edit mode
    if (successfulUrls.length > 0 && !this.isEditing()) {
      await this.savePhotosToProfile();
    }
  }

  private updateUploadingPhotoStatus(id: string, status: 'uploading' | 'success' | 'error', error?: string): void {
    this.uploadingPhotos.update(photos => 
      photos.map(p => p.id === id ? { ...p, status, error } : p)
    );
  }

  private removeUploadingPhoto(id: string): void {
    this.uploadingPhotos.update(photos => photos.filter(p => p.id !== id));
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
    // If this photo is private, make it public first (profile photo can't be private)
    if (this.photoPrivacy().get(photoUrl)) {
      await this.togglePhotoPrivacy(photoUrl);
    }
    
    this.profilePhotoUrl.set(photoUrl);

    // If not editing, save immediately
    if (!this.isEditing()) {
      await this.updateProfilePhoto(photoUrl);
    }
  }

  // Photo privacy management
  async togglePhotoPrivacy(photoUrl: string): Promise<void> {
    // Cannot make profile photo private
    if (photoUrl === this.profilePhotoUrl()) {
      this.uploadError.set('Profile photo cannot be private. Choose a different profile photo first.');
      setTimeout(() => this.uploadError.set(null), 3000);
      return;
    }

    const currentPrivacy = this.photoPrivacy().get(photoUrl) || false;
    const newPrivacy = !currentPrivacy;

    try {
      await this.photoAccessService.togglePhotoPrivacy(photoUrl, newPrivacy);
      
      // Update local state
      this.photoPrivacy.update(map => {
        const newMap = new Map(map);
        newMap.set(photoUrl, newPrivacy);
        return newMap;
      });
    } catch (error) {
      console.error('Error toggling photo privacy:', error);
      this.uploadError.set('Failed to update photo privacy');
      setTimeout(() => this.uploadError.set(null), 3000);
    }
  }

  isPhotoPrivate(photoUrl: string): boolean {
    return this.photoPrivacy().get(photoUrl) || false;
  }

  // Open the photo access management dialog
  openAccessDialog(): void {
    this.dialog.open(PhotoAccessDialogComponent, {
      panelClass: 'photo-access-dialog-panel',
      width: '420px',
      maxWidth: '95vw',
    });
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

  selectSupportOrientation(value: string): void {
    this.editForm.supportOrientation = value;
  }

  formatSupportOrientation(value: string | undefined): string {
    return getSupportOrientationLabel(value);
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
    return types.map(t => getConnectionTypeLabel(t)).join(', ');
  }

  protected getConnectionTypeLabel(type: string): string {
    return getConnectionTypeLabel(type);
  }
}
