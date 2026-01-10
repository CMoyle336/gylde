import { ChangeDetectionStrategy, Component, inject, computed, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import { StorageService } from '../../../core/services/storage.service';
import { AuthService } from '../../../core/services/auth.service';

interface PhotoUpload {
  url: string;
  preview: string; // Local preview while uploading or after
}

@Component({
  selector: 'app-step-7-photos',
  templateUrl: './step-7-photos.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class Step7PhotosComponent {
  protected readonly onboarding = inject(OnboardingService);
  private readonly storageService = inject(StorageService);
  private readonly authService = inject(AuthService);
  
  protected readonly maxPhotos = 6;
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  // Store local previews for display (URLs or base64 for preview)
  protected readonly photoPreviews = signal<PhotoUpload[]>([]);

  protected readonly photos = computed(() => this.onboarding.data().photos);
  protected readonly emptySlots = computed(() => {
    const photoCount = this.photoPreviews().length;
    return Array(Math.max(0, this.maxPhotos - photoCount - 1)).fill(null);
  });

  protected async onFileSelected(event: Event, isPrimary: boolean): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!this.isValidImage(file)) {
      this.uploadError.set('Please select a valid image (JPG or PNG, max 10MB)');
      return;
    }

    const user = this.authService.user();
    if (!user) {
      this.uploadError.set('You must be logged in to upload photos');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);

    try {
      // Create local preview
      const preview = await this.createPreview(file);
      
      // Generate storage path
      const path = this.storageService.generateFilePath(user.uid, 'photos', file.name);
      
      // Upload to Firebase Storage
      const downloadUrl = await this.storageService.uploadFileWithProgress(path, file, (progress) => {
        console.log(`Upload progress: ${progress.progress.toFixed(0)}%`);
      });

      // Update previews and stored URLs
      const currentPreviews = this.photoPreviews();
      const currentUrls = this.onboarding.data().photos;

      if (isPrimary && currentPreviews.length === 0) {
        this.photoPreviews.set([{ url: downloadUrl, preview }]);
        this.onboarding.updateData({ photos: [downloadUrl] });
      } else if (currentPreviews.length < this.maxPhotos) {
        this.photoPreviews.set([...currentPreviews, { url: downloadUrl, preview }]);
        this.onboarding.updateData({ photos: [...currentUrls, downloadUrl] });
      }
    } catch (error) {
      console.error('Failed to upload photo:', error);
      this.uploadError.set('Failed to upload photo. Please try again.');
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  protected removePhoto(index: number): void {
    const currentPreviews = this.photoPreviews();
    const currentUrls = this.onboarding.data().photos;
    
    this.photoPreviews.set(currentPreviews.filter((_, i) => i !== index));
    this.onboarding.updateData({
      photos: currentUrls.filter((_, i) => i !== index),
    });
  }

  private isValidImage(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    return validTypes.includes(file.type) && file.size <= maxSize;
  }

  private createPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
