import { ChangeDetectionStrategy, Component, ElementRef, OnInit, OnDestroy, ViewChild, effect, inject, signal, computed, PLATFORM_ID, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { AuthService } from '../../core/services/auth.service';
import { PhotoAccessService } from '../../core/services/photo-access.service';
import { PlacesService, PlaceSuggestion } from '../../core/services/places.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AiChatService } from '../../core/services/ai-chat.service';
import { OnboardingProfile, GeoLocation, ReputationTier, TIER_CONFIG } from '../../core/interfaces';
import { Photo } from '../../core/interfaces/photo.interface';
import { ALL_CONNECTION_TYPES, getConnectionTypeLabel, SUPPORT_ORIENTATION_OPTIONS, getSupportOrientationLabel } from '../../core/constants/connection-types';
import { PhotoAccessDialogComponent } from '../../components/photo-access-dialog';
import { ReputationBadgeComponent } from '../../components/reputation-badge';
import { ReputationInfoDialogComponent } from '../../components/reputation-info-dialog';
import { FounderBadgeComponent } from '../../components/founder-badge';
import { environment } from '../../../environments/environment';

type LocationStatus = 'idle' | 'detecting' | 'success' | 'error';

interface EditForm {
  // Basic info
  displayName: string;
  city: string;
  tagline: string; // Short phrase for profile
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
  income: string;
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
    DragDropModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ReputationBadgeComponent,
    FounderBadgeComponent,
  ],
})
export class ProfileComponent implements OnInit, OnDestroy {
  private readonly userProfileService = inject(UserProfileService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly authService = inject(AuthService);
  private readonly photoAccessService = inject(PhotoAccessService);
  private readonly placesService = inject(PlacesService);
  protected readonly subscriptionService = inject(SubscriptionService);
  private readonly aiChatService = inject(AiChatService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialog = inject(MatDialog);
  private readonly functions = inject(Functions);

  // Development mode flag
  protected readonly isDev = !environment.production;

  protected readonly uploadError = signal<string | null>(null);
  
  // Reputation refresh state (dev only)
  protected readonly refreshingReputation = signal(false);

  @ViewChild('photoInput') photoInput!: ElementRef<HTMLInputElement>;

  // Location autocomplete
  private readonly cityInputRef = viewChild<ElementRef<HTMLInputElement>>('cityInput');
  protected readonly locationStatus = signal<LocationStatus>('idle');
  protected readonly locationMessage = signal<string | null>(null);
  protected readonly cityInputValue = signal('');
  protected readonly suggestions = signal<PlaceSuggestion[]>([]);
  protected readonly showSuggestions = signal(false);
  protected readonly isSearchingLocation = signal(false);
  protected readonly highlightedIndex = signal(-1);
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private clickOutsideHandler = (e: MouseEvent) => this.onClickOutside(e);
  
  // Store location data for saving
  private pendingLocation: GeoLocation | null = null;
  private pendingCountry: string = '';

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

  // Max photos allowed based on subscription tier
  protected readonly maxPhotos = computed(() => this.subscriptionService.capabilities().maxPhotos);

  // Reputation data from subscription service
  protected readonly reputationData = this.subscriptionService.reputationData;

  // Founder status
  protected readonly isFounder = this.subscriptionService.isFounder;
  protected readonly founderCity = this.subscriptionService.founderCity;

  // Reputation tier for display
  protected readonly reputationTier = computed<ReputationTier>(() => {
    return this.reputationData()?.tier ?? 'new';
  });

  // Higher-tier conversation limits (premium users have unlimited)
  protected readonly higherTierConversationStatus = computed(() => {
    // Premium users have unlimited conversations
    if (this.isPremium()) {
      return {
        dailyLimit: -1, // -1 means unlimited
        usedToday: 0,
        remaining: -1, // -1 means unlimited
        isUnlimited: true,
      };
    }

    const rep = this.reputationData();
    const tier = rep?.tier ?? 'new';
    const config = TIER_CONFIG[tier];
    const dailyLimit = rep?.dailyHigherTierConversationLimit ?? config.dailyHigherTierConversations;
    const usedToday = rep?.higherTierConversationsToday ?? 0;
    
    // Check if tier has unlimited (-1)
    const isUnlimited = dailyLimit === -1;
    
    return {
      dailyLimit,
      usedToday,
      remaining: isUnlimited ? -1 : Math.max(0, dailyLimit - usedToday),
      isUnlimited,
    };
  });

  /**
   * Manually refresh reputation (development only)
   */
  async refreshReputation(): Promise<void> {
    if (!this.isDev) return;
    
    this.refreshingReputation.set(true);
    try {
      const refreshFn = httpsCallable<void, { success: boolean; tier: string }>(
        this.functions,
        'refreshMyReputation'
      );
      const result = await refreshFn();
      console.log('Reputation refreshed:', result.data);
      // The subscription service will pick up the changes from Firestore
    } catch (error) {
      console.error('Failed to refresh reputation:', error);
    } finally {
      this.refreshingReputation.set(false);
    }
  }

  // AI Polish state (Premium feature)
  protected readonly isPremium = computed(() => this.subscriptionService.isPremium());
  protected readonly polishingField = signal<string | null>(null);
  protected readonly polishSuggestions = signal<{ field: string; polished: string; alternatives: string[] } | null>(null);

  // Messaging info - everyone can message everyone now
  // The only limit is on starting NEW conversations with higher-tier users
  protected readonly canMessageInfo = computed(() => {
    return {
      canMessageAll: true,
      description: 'You can message anyone. New conversations with higher-tier members are limited per day.',
    };
  });

  /**
   * Open the reputation info dialog
   */
  protected openReputationInfo(): void {
    this.dialog.open(ReputationInfoDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      maxHeight: '90vh',
    });
  }

  // Check if user has any private photos
  protected readonly hasPrivatePhotos = computed(() => {
    const privacyMap = this.photoPrivacy();
    return Array.from(privacyMap.values()).some(isPrivate => isPrivate);
  });

  // Computed: photos with their privacy status, profile photo always first
  protected readonly photosWithPrivacy = computed(() => {
    const photos = this.editablePhotos();
    const privacyMap = this.photoPrivacy();
    const profilePhoto = this.profilePhotoUrl();
    
    const photoItems = photos.map(url => ({
      url,
      isPrivate: privacyMap.get(url) || false,
      isProfilePhoto: url === profilePhoto,
    }));
    
    // Sort so profile photo is always first
    return photoItems.sort((a, b) => {
      if (a.isProfilePhoto) return -1;
      if (b.isProfilePhoto) return 1;
      return 0;
    });
  });

  constructor() {
    // Sync photos from profile when not editing
    effect(() => {
      const profile = this.profile();
      if (profile && !this.isEditing()) {
        this.syncPhotosFromProfile(profile);
      }
    });
  }

  /**
   * Sync local photo state from profile photoDetails
   */
  private syncPhotosFromProfile(profile: { onboarding?: { photoDetails?: Photo[] }; photoURL?: string | null }): void {
    const photoDetails = profile.onboarding?.photoDetails || [];
    
    // Sort by order and extract URLs
    const sortedDetails = [...photoDetails].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.editablePhotos.set(sortedDetails.map(p => p.url));
        this.profilePhotoUrl.set(profile.photoURL || null);
        
        // Sync photo privacy state
        const privacyMap = new Map<string, boolean>();
    for (const detail of photoDetails) {
          privacyMap.set(detail.url, detail.isPrivate);
        }
        this.photoPrivacy.set(privacyMap);
  }

  ngOnInit(): void {
    // Initial sync
    const profile = this.profile();
    if (profile) {
      this.syncPhotosFromProfile(profile);
    }

    // Add click outside listener for autocomplete
    if (isPlatformBrowser(this.platformId)) {
      document.addEventListener('click', this.clickOutsideHandler);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.removeEventListener('click', this.clickOutsideHandler);
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  // Edit form data
  protected editForm: EditForm = {
    displayName: '',
    city: '',
    tagline: '',
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
    income: '',
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

  protected readonly incomeOptions = [
    'Under $50,000', '$50,000 - $100,000', '$100,000 - $150,000', '$150,000 - $200,000',
    '$200,000 - $300,000', '$300,000 - $500,000', '$500,000 - $1,000,000', 'Over $1,000,000',
    'Prefer not to say'
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

    // Initialize city input value for autocomplete
    const cityDisplay = profile.onboarding?.city 
      ? `${profile.onboarding.city}, ${profile.onboarding.country || ''}`.trim().replace(/, $/, '')
      : '';
    this.cityInputValue.set(cityDisplay);
    
    // Store existing location data
    this.pendingLocation = profile.onboarding?.location || null;
    this.pendingCountry = profile.onboarding?.country || '';

    // Initialize form with current values
    this.editForm = {
      displayName: profile.displayName || '',
      city: profile.onboarding?.city || '',
      tagline: profile.onboarding?.tagline || '',
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
      income: profile.onboarding?.income || '',
    };

    // Photos are already synced via effect
    this.isEditing.set(true);
  }

  cancelEditing(): void {
    // Reset to original values from profile
    const profile = this.profile();
    if (profile) {
      this.syncPhotosFromProfile(profile);
    }
    
    // Reset location state
    this.suggestions.set([]);
    this.showSuggestions.set(false);
    this.locationStatus.set('idle');
    this.locationMessage.set(null);
    this.pendingLocation = null;
    this.pendingCountry = '';
    
    this.isEditing.set(false);
  }

  async saveProfile(): Promise<void> {
    const profile = this.profile();
    if (!profile || !profile.onboarding) return;

    this.saving.set(true);

    try {
      const photos = this.editablePhotos();
      const profilePhoto = this.profilePhotoUrl() || photos[0] || null;

      // Use the city from editForm (set by autocomplete)
      const city = this.editForm.city || profile.onboarding.city || '';
      const country = this.pendingCountry || profile.onboarding.country || '';
      const location = this.pendingLocation || profile.onboarding.location;

      // Build updated onboarding data
      const photoDetails = this.buildPhotoDetails();
      const updatedOnboarding: Partial<OnboardingProfile> = {
        ...profile.onboarding,
        city,
        country,
        ...(location && { location }),
        tagline: this.editForm.tagline,
        genderIdentity: this.editForm.genderIdentity,
        interestedIn: this.editForm.interestedIn,
        ageRangeMin: this.editForm.ageRangeMin,
        ageRangeMax: this.editForm.ageRangeMax,
        connectionTypes: this.editForm.connectionTypes,
        supportOrientation: this.editForm.supportOrientation,
        idealRelationship: this.editForm.idealRelationship,
        supportMeaning: this.editForm.supportMeaning,
        photoDetails,
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
      if (this.editForm.income) updatedOnboarding.income = this.editForm.income;

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
    const maxAllowed = this.maxPhotos();
    const availableSlots = maxAllowed - currentPhotos.length - currentUploading;
    
    // Check if user can upload more photos
    if (availableSlots <= 0) {
      this.uploadError.set(`Maximum of ${maxAllowed} photos allowed for your subscription tier`);
      input.value = '';
      return;
    }

    // Get files to upload (limited by available slots)
    const filesToUpload = Array.from(files).slice(0, availableSlots);
    
    if (filesToUpload.length < files.length) {
      this.uploadError.set(`Only ${availableSlots} more photo(s) can be added. Maximum is ${maxAllowed}.`);
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

  async removePhoto(photoUrl: string): Promise<void> {
    // Prevent deleting the profile photo
    if (photoUrl === this.profilePhotoUrl()) {
      this.uploadError.set('Profile photo cannot be deleted. Set another photo as profile first.');
      setTimeout(() => this.uploadError.set(null), 3000);
      return;
    }
    
    const photos = this.editablePhotos();
    const newPhotos = photos.filter(url => url !== photoUrl);
    this.editablePhotos.set(newPhotos);

    // If not editing, save immediately
    // Storage cleanup is handled by Cloud Function trigger on user document
    if (!this.isEditing()) {
      await this.savePhotosToProfile();
    }
  }

  /**
   * Handle drag and drop reordering of photos
   * Profile photo (index 0) is locked and cannot be moved
   */
  async onPhotoDrop(event: CdkDragDrop<string[]>): Promise<void> {
    // Adjust indices since profile photo is always at index 0 and locked
    // The draggable items start at index 1 in the visual list
    const fromIndex = event.previousIndex;
    const toIndex = event.currentIndex;
    
    // Don't allow moving to/from position 0 (profile photo)
    if (fromIndex === 0 || toIndex === 0) {
      return;
    }
    
    // Get current photos and reorder
    const photos = [...this.editablePhotos()];
    const profilePhoto = this.profilePhotoUrl();
    
    // Find the actual indices in the editablePhotos array
    // (accounting for profile photo always being displayed first)
    const sortedPhotos = [...photos].sort((a, b) => {
      if (a === profilePhoto) return -1;
      if (b === profilePhoto) return 1;
      return 0;
    });
    
    // Get the URLs at the visual positions
    const movedUrl = sortedPhotos[fromIndex];
    const targetUrl = sortedPhotos[toIndex];
    
    // Find their positions in the original array
    const originalFromIndex = photos.indexOf(movedUrl);
    const originalToIndex = photos.indexOf(targetUrl);
    
    if (originalFromIndex === -1 || originalToIndex === -1) {
      return;
    }
    
    // Perform the move in the original array
    moveItemInArray(photos, originalFromIndex, originalToIndex);
    this.editablePhotos.set(photos);

    // If not editing, save immediately
    if (!this.isEditing()) {
      await this.savePhotosToProfile();
    }
  }

  async setAsProfilePhoto(photoUrl: string): Promise<void> {
    // Private photos cannot be set as profile photo
    if (this.photoPrivacy().get(photoUrl)) {
      this.uploadError.set('Private photos cannot be set as your profile photo. Make it public first.');
      setTimeout(() => this.uploadError.set(null), 3000);
      return;
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

  /**
   * Build photoDetails array from current state
   */
  private buildPhotoDetails(): Photo[] {
    const photos = this.editablePhotos();
    const privacyMap = this.photoPrivacy();
    const profilePhoto = this.profilePhotoUrl();
    
    // Sort with profile photo first, then by current order
    const sortedPhotos = [...photos].sort((a, b) => {
      if (a === profilePhoto) return -1;
      if (b === profilePhoto) return 1;
      return 0;
    });
    
    return sortedPhotos.map((url, index) => ({
      id: url.split('/').pop()?.split('?')[0] || `photo-${index}`,
      url,
      isPrivate: privacyMap.get(url) || false,
      uploadedAt: new Date(), // Will be preserved by merge on server
      order: index,
    }));
  }

  private async savePhotosToProfile(): Promise<void> {
    const profile = this.profile();
    if (!profile || !profile.onboarding) return;

    const photoDetails = this.buildPhotoDetails();
    const photos = this.editablePhotos();
    const newProfilePhoto = this.profilePhotoUrl() || photos[0] || null;

    await this.userProfileService.updateProfile({
      photoURL: newProfilePhoto,
      onboarding: {
        ...profile.onboarding,
        photoDetails,
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

  // ============================================
  // Location Autocomplete Methods
  // ============================================

  /**
   * Handle input changes - trigger autocomplete search
   */
  protected onLocationInputChange(value: string): void {
    this.cityInputValue.set(value);
    this.highlightedIndex.set(-1);

    // Clear previous timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    if (!value.trim()) {
      this.suggestions.set([]);
      this.showSuggestions.set(false);
      return;
    }

    // Debounce search
    this.searchDebounceTimer = setTimeout(() => {
      this.searchPlaces(value);
    }, 300);
  }

  /**
   * Search for places matching the input
   */
  private async searchPlaces(query: string): Promise<void> {
    this.isSearchingLocation.set(true);

    try {
      const results = await this.placesService.getSuggestions(query);
      this.suggestions.set(results);
      this.showSuggestions.set(results.length > 0);
    } catch (error) {
      console.error('Failed to search places:', error);
      this.suggestions.set([]);
    } finally {
      this.isSearchingLocation.set(false);
    }
  }

  /**
   * Handle selecting a suggestion
   */
  protected async selectSuggestion(suggestion: PlaceSuggestion): Promise<void> {
    this.showSuggestions.set(false);
    this.cityInputValue.set(suggestion.description);
    this.isSearchingLocation.set(true);

    try {
      const details = await this.placesService.getPlaceDetails(suggestion.placeId);

      if (details) {
        // Store the location data for saving
        this.editForm.city = details.city;
        this.pendingCountry = details.countryCode;
        this.pendingLocation = details.location;
        
        this.locationStatus.set('success');
        this.locationMessage.set(null);
      }
    } catch (error) {
      console.error('Failed to get place details:', error);
    } finally {
      this.isSearchingLocation.set(false);
    }
  }

  /**
   * Handle keyboard navigation in autocomplete
   */
  protected onLocationKeyDown(event: KeyboardEvent): void {
    const suggestionsList = this.suggestions();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.highlightedIndex.update((i) =>
          i < suggestionsList.length - 1 ? i + 1 : 0
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlightedIndex.update((i) =>
          i > 0 ? i - 1 : suggestionsList.length - 1
        );
        break;
      case 'Enter':
        event.preventDefault();
        const idx = this.highlightedIndex();
        if (idx >= 0 && idx < suggestionsList.length) {
          this.selectSuggestion(suggestionsList[idx]);
        }
        break;
      case 'Escape':
        this.showSuggestions.set(false);
        this.highlightedIndex.set(-1);
        break;
    }
  }

  /**
   * Show suggestions on focus if we have results
   */
  protected onLocationInputFocus(): void {
    if (this.suggestions().length > 0) {
      this.showSuggestions.set(true);
    }
  }

  /**
   * Handle click outside to close suggestions
   */
  private onClickOutside(event: MouseEvent): void {
    const inputEl = this.cityInputRef()?.nativeElement;
    if (inputEl && !inputEl.contains(event.target as Node)) {
      // Also check if clicking on the suggestions list
      const target = event.target as HTMLElement;
      if (!target.closest('.suggestions-list')) {
        this.showSuggestions.set(false);
      }
    }
  }

  /**
   * Request browser geolocation and reverse geocode to get city
   */
  protected requestGeolocation(): void {
    if (!navigator.geolocation) {
      this.locationStatus.set('error');
      this.locationMessage.set('Geolocation is not supported by your browser');
      return;
    }

    this.locationStatus.set('detecting');
    this.locationMessage.set(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location: GeoLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        // Reverse geocode to get city info
        const result = await this.placesService.reverseGeocode(
          location.latitude,
          location.longitude
        );

        if (result) {
          // Update form and pending location data
          this.editForm.city = result.city;
          this.pendingCountry = result.countryCode;
          this.pendingLocation = result.location;
          
          // Update UI
          this.cityInputValue.set(result.description);
          this.locationStatus.set('success');
          this.locationMessage.set('Location detected!');
          
          // Clear message after 3 seconds
          setTimeout(() => {
            if (this.locationStatus() === 'success') {
              this.locationMessage.set(null);
            }
          }, 3000);
        } else {
          this.locationStatus.set('error');
          this.locationMessage.set('Could not determine your city. Please type it manually.');
        }
      },
      (error) => {
        this.locationStatus.set('error');
        switch (error.code) {
          case error.PERMISSION_DENIED:
            this.locationMessage.set('Location access denied');
            break;
          case error.POSITION_UNAVAILABLE:
            this.locationMessage.set('Location unavailable');
            break;
          case error.TIMEOUT:
            this.locationMessage.set('Location request timed out');
            break;
          default:
            this.locationMessage.set('Could not detect location');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  }

  // ============================================
  // AI POLISH (Premium Feature)
  // ============================================

  protected async polishText(field: 'tagline' | 'idealRelationship' | 'supportMeaning'): Promise<void> {
    const text = this.editForm[field];
    if (!text || text.trim().length < 3) {
      return;
    }

    this.polishingField.set(field);
    this.polishSuggestions.set(null);

    try {
      const maxLength = field === 'tagline' ? 100 : 500;
      const profileContext = this.buildProfileContext();
      const result = await this.aiChatService.polishProfileText(text, field, maxLength, profileContext);
      
      this.polishSuggestions.set({
        field,
        polished: result.polished,
        alternatives: result.suggestions,
      });
    } catch (error) {
      console.error('AI polish failed:', error);
    } finally {
      this.polishingField.set(null);
    }
  }

  /**
   * Build profile context for AI polish
   */
  private buildProfileContext() {
    const profile = this.profile();
    if (!profile) return undefined;

    const onboarding = profile.onboarding;
    
    // Calculate age from birthDate
    let age: number | undefined;
    if (onboarding?.birthDate) {
      const birthDate = new Date(onboarding.birthDate);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    return {
      displayName: profile.displayName || undefined,
      age,
      city: onboarding?.city,
      genderIdentity: onboarding?.genderIdentity,
      tagline: this.editForm.tagline || onboarding?.tagline,
      connectionTypes: onboarding?.connectionTypes,
      supportOrientation: onboarding?.supportOrientation,
      idealRelationship: this.editForm.idealRelationship || onboarding?.idealRelationship,
      supportMeaning: this.editForm.supportMeaning || onboarding?.supportMeaning,
      occupation: this.editForm.occupation || onboarding?.occupation,
      education: this.editForm.education || onboarding?.education,
    };
  }

  protected applyPolish(text: string): void {
    const suggestion = this.polishSuggestions();
    if (!suggestion) return;

    const field = suggestion.field;
    switch (field) {
      case 'tagline':
        this.editForm.tagline = text;
        break;
      case 'idealRelationship':
        this.editForm.idealRelationship = text;
        break;
      case 'supportMeaning':
        this.editForm.supportMeaning = text;
        break;
    }
    
    this.polishSuggestions.set(null);
  }

  protected dismissPolishSuggestions(): void {
    this.polishSuggestions.set(null);
  }
}
