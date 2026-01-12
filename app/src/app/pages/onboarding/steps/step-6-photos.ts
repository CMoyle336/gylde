import { ChangeDetectionStrategy, Component, inject, computed, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';
import { ImageUploadService } from '../../../core/services/image-upload.service';
import { MAX_PHOTOS_PER_USER } from '../../../core/constants/app-config';

interface PhotoUpload {
  url: string;
  preview: string; // Local preview while uploading or after
}

interface UploadingPhoto {
  id: string;
  preview: string;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

@Component({
  selector: 'app-step-6-photos',
  templateUrl: './step-6-photos.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class Step6PhotosComponent {
  protected readonly onboarding = inject(OnboardingService);
  private readonly imageUploadService = inject(ImageUploadService);
  
  protected readonly maxPhotos = MAX_PHOTOS_PER_USER;
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  // Store local previews for display (URLs or base64 for preview)
  protected readonly photoPreviews = signal<PhotoUpload[]>([]);
  
  // Photos currently being uploaded (with preview and status)
  protected readonly uploadingPhotos = signal<UploadingPhoto[]>([]);

  protected readonly photos = computed(() => this.onboarding.data().photos);
  protected readonly emptySlots = computed(() => {
    const photoCount = this.photoPreviews().length + this.uploadingPhotos().length;
    return Array(Math.max(0, this.maxPhotos - photoCount - 1)).fill(null);
  });

  /**
   * Handle single file selection (for primary photo)
   */
  protected async onFileSelected(event: Event, isPrimary: boolean): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    
    // Clear previous error
    this.uploadError.set(null);

    // Validate file FIRST before any processing
    const validation = this.imageUploadService.validateFile(file);
    if (!validation.valid) {
      this.uploadError.set(validation.error || 'Invalid file');
      input.value = '';
      return;
    }

    // Reset input immediately
    input.value = '';

    // Create local preview and add to uploading list
    const preview = await this.imageUploadService.createPreview(file);
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.uploadingPhotos.set([...this.uploadingPhotos(), { 
      id: uploadId, 
      preview, 
      status: 'uploading' 
    }]);

    try {
      // Upload via secure Cloud Function
      const result = await this.imageUploadService.uploadImage(file, 'photos');

      if (!result.success || !result.url) {
        this.updateUploadStatus(uploadId, 'error', result.error);
        setTimeout(() => this.removeUploadingPhoto(uploadId), 3000);
        return;
      }

      const downloadUrl = result.url;

      // Remove from uploading list BEFORE adding to previews
      this.removeUploadingPhoto(uploadId);

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
      const errorMessage = error instanceof Error ? error.message : 'Failed to upload';
      this.updateUploadStatus(uploadId, 'error', errorMessage);
      setTimeout(() => this.removeUploadingPhoto(uploadId), 3000);
    }
  }

  /**
   * Handle multiple file selection (for additional photos)
   */
  protected async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    // Clear previous error
    this.uploadError.set(null);

    const currentPreviews = this.photoPreviews();
    const currentUploading = this.uploadingPhotos().length;
    const availableSlots = this.maxPhotos - currentPreviews.length - currentUploading;

    if (availableSlots <= 0) {
      this.uploadError.set(`Maximum of ${this.maxPhotos} photos allowed`);
      input.value = '';
      return;
    }

    // Get files to upload (limited by available slots)
    const filesToUpload = Array.from(input.files).slice(0, availableSlots);
    
    if (filesToUpload.length < input.files.length) {
      this.uploadError.set(`Only ${availableSlots} more photo(s) can be added. Maximum is ${this.maxPhotos}.`);
    }

    // Validate all files first
    for (const file of filesToUpload) {
      const validation = this.imageUploadService.validateFile(file);
      if (!validation.valid) {
        this.uploadError.set(validation.error || 'Invalid file');
        input.value = '';
        return;
      }
    }

    // Reset input immediately
    input.value = '';

    // Create previews and add to uploading list
    const uploadingItems: UploadingPhoto[] = [];
    for (const file of filesToUpload) {
      const preview = await this.imageUploadService.createPreview(file);
      const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      uploadingItems.push({ id, preview, status: 'uploading' });
    }
    
    this.uploadingPhotos.set([...this.uploadingPhotos(), ...uploadingItems]);

    // Upload each file individually and update status
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const uploadItem = uploadingItems[i];
      
      try {
        const result = await this.imageUploadService.uploadImage(file, 'photos');
        
        if (result.success && result.url) {
          // Remove from uploading list BEFORE adding to previews
          this.removeUploadingPhoto(uploadItem.id);
          
          // Add to photo previews
          const currentPreviews = this.photoPreviews();
          const currentUrls = this.onboarding.data().photos;
          this.photoPreviews.set([...currentPreviews, { url: result.url, preview: uploadItem.preview }]);
          this.onboarding.updateData({ photos: [...currentUrls, result.url] });
        } else {
          this.updateUploadStatus(uploadItem.id, 'error', result.error);
          setTimeout(() => this.removeUploadingPhoto(uploadItem.id), 3000);
        }
      } catch (error) {
        console.error('Error uploading photo:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        this.updateUploadStatus(uploadItem.id, 'error', errorMessage);
        setTimeout(() => this.removeUploadingPhoto(uploadItem.id), 3000);
      }
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

  /**
   * Set a photo as the primary/profile photo by moving it to index 0
   */
  protected setAsPrimary(index: number): void {
    if (index === 0) return; // Already primary
    
    const currentPreviews = [...this.photoPreviews()];
    const currentUrls = [...this.onboarding.data().photos];
    
    // Move selected photo to the front
    const [selectedPreview] = currentPreviews.splice(index, 1);
    const [selectedUrl] = currentUrls.splice(index, 1);
    
    currentPreviews.unshift(selectedPreview);
    currentUrls.unshift(selectedUrl);
    
    this.photoPreviews.set(currentPreviews);
    this.onboarding.updateData({ photos: currentUrls });
  }

  private updateUploadStatus(id: string, status: 'uploading' | 'success' | 'error', error?: string): void {
    this.uploadingPhotos.update(photos => 
      photos.map(p => p.id === id ? { ...p, status, error } : p)
    );
  }

  private removeUploadingPhoto(id: string): void {
    this.uploadingPhotos.update(photos => photos.filter(p => p.id !== id));
  }
}
