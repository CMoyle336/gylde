import { Injectable, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export interface UploadProgress {
  status: 'idle' | 'reading' | 'uploading' | 'complete' | 'error';
  progress: number; // 0-100
  error?: string;
}

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

interface UploadImageRequest {
  imageData: string;
  mimeType: string;
  fileName?: string;
  folder?: string;
}

interface UploadImageResponse {
  success: boolean;
  url?: string;
  error?: string;
}

interface ImageInput {
  imageData: string;
  mimeType: string;
  fileName?: string;
}

interface UploadImagesRequest {
  images: ImageInput[];
  folder?: string;
}

interface ImageResult {
  success: boolean;
  url?: string;
  error?: string;
  fileName?: string;
}

interface UploadImagesResponse {
  success: boolean;
  results: ImageResult[];
  successCount: number;
  failureCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class ImageUploadService {
  private readonly functions = inject(Functions);

  private readonly _uploadProgress = signal<UploadProgress>({
    status: 'idle',
    progress: 0,
  });

  readonly uploadProgress = this._uploadProgress.asReadonly();

  /**
   * Upload an image file via Cloud Function
   * This provides server-side validation for security
   */
  async uploadImage(
    file: File,
    folder: string = 'photos',
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    // Validate client-side first (for better UX)
    const validation = this.validateFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      // Update progress - reading file
      this._uploadProgress.set({ status: 'reading', progress: 10 });
      onProgress?.(this._uploadProgress());

      // Convert file to base64
      const base64Data = await this.fileToBase64(file);

      // Update progress - uploading
      this._uploadProgress.set({ status: 'uploading', progress: 30 });
      onProgress?.(this._uploadProgress());

      // Call Cloud Function
      const uploadFn = httpsCallable<UploadImageRequest, UploadImageResponse>(
        this.functions,
        'uploadProfileImage'
      );

      const result = await uploadFn({
        imageData: base64Data,
        mimeType: file.type,
        fileName: file.name,
        folder,
      });

      // Update progress - complete
      this._uploadProgress.set({ status: 'complete', progress: 100 });
      onProgress?.(this._uploadProgress());

      if (result.data.success && result.data.url) {
        return { success: true, url: result.data.url };
      } else {
        return { success: false, error: result.data.error || 'Upload failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this._uploadProgress.set({ status: 'error', progress: 0, error: errorMessage });
      onProgress?.(this._uploadProgress());
      return { success: false, error: errorMessage };
    } finally {
      // Reset progress after a short delay
      setTimeout(() => {
        this._uploadProgress.set({ status: 'idle', progress: 0 });
      }, 1000);
    }
  }

  // Max total payload size for batch uploads (in bytes)
  // Cloud Functions has a 10MB limit, but base64 adds ~33% overhead
  // Use a conservative 6MB threshold to be safe
  private readonly MAX_BATCH_PAYLOAD_SIZE = 6 * 1024 * 1024;

  /**
   * Upload multiple images - automatically chooses between batch and sequential
   * based on total payload size to avoid request body limits
   */
  async uploadImages(
    files: File[],
    folder: string = 'photos',
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult[]> {
    if (files.length === 0) {
      return [];
    }

    // Validate all files first
    for (const file of files) {
      const validation = this.validateFile(file);
      if (!validation.valid) {
        return files.map((f) => 
          f === file 
            ? { success: false, error: validation.error } 
            : { success: false, error: 'Upload cancelled due to invalid file' }
        );
      }
    }

    // Calculate total file size (base64 adds ~33% overhead)
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const estimatedPayloadSize = totalSize * 1.34; // Base64 overhead

    // If payload would be too large, use sequential uploads
    if (estimatedPayloadSize > this.MAX_BATCH_PAYLOAD_SIZE || files.length === 1) {
      return this.uploadImagesSequentially(files, folder, onProgress);
    }

    // Use batch upload for smaller payloads
    return this.uploadImagesBatch(files, folder, onProgress);
  }

  /**
   * Upload images sequentially (one at a time)
   * Used when total payload would exceed request body limits
   */
  private async uploadImagesSequentially(
    files: File[],
    folder: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const total = files.length;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Update progress
        const progressPercent = Math.round((i / total) * 100);
        this._uploadProgress.set({ 
          status: 'uploading', 
          progress: progressPercent 
        });
        onProgress?.(this._uploadProgress());

        // Upload single file (without its own progress tracking)
        const result = await this.uploadImageInternal(file, folder);
        results.push(result);

        // If one fails, continue with the rest but track the error
        if (!result.success) {
          console.warn(`Failed to upload ${file.name}:`, result.error);
        }
      }

      // Update progress - complete
      this._uploadProgress.set({ status: 'complete', progress: 100 });
      onProgress?.(this._uploadProgress());

      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this._uploadProgress.set({ status: 'error', progress: 0, error: errorMessage });
      onProgress?.(this._uploadProgress());
      
      // Fill remaining results with errors
      while (results.length < files.length) {
        results.push({ success: false, error: errorMessage });
      }
      return results;
    } finally {
      setTimeout(() => {
        this._uploadProgress.set({ status: 'idle', progress: 0 });
      }, 1000);
    }
  }

  /**
   * Internal single image upload without progress management
   */
  private async uploadImageInternal(file: File, folder: string): Promise<UploadResult> {
    try {
      const base64Data = await this.fileToBase64(file);

      const uploadFn = httpsCallable<UploadImageRequest, UploadImageResponse>(
        this.functions,
        'uploadProfileImage'
      );

      const result = await uploadFn({
        imageData: base64Data,
        mimeType: file.type,
        fileName: file.name,
        folder,
      });

      if (result.data.success && result.data.url) {
        return { success: true, url: result.data.url };
      } else {
        return { success: false, error: result.data.error || 'Upload failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Upload images in a single batch request
   * Only used when total payload is under the size limit
   */
  private async uploadImagesBatch(
    files: File[],
    folder: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult[]> {
    try {
      // Update progress - reading files
      this._uploadProgress.set({ status: 'reading', progress: 10 });
      onProgress?.(this._uploadProgress());

      // Convert all files to base64
      const imageInputs: ImageInput[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64Data = await this.fileToBase64(file);
        imageInputs.push({
          imageData: base64Data,
          mimeType: file.type,
          fileName: file.name,
        });
        // Update progress during reading
        const readProgress = 10 + ((i + 1) / files.length) * 20;
        this._uploadProgress.set({ status: 'reading', progress: readProgress });
        onProgress?.(this._uploadProgress());
      }

      // Update progress - uploading
      this._uploadProgress.set({ status: 'uploading', progress: 40 });
      onProgress?.(this._uploadProgress());

      // Call batch upload Cloud Function
      const uploadFn = httpsCallable<UploadImagesRequest, UploadImagesResponse>(
        this.functions,
        'uploadProfileImages'
      );

      const result = await uploadFn({
        images: imageInputs,
        folder,
      });

      // Update progress - complete
      this._uploadProgress.set({ status: 'complete', progress: 100 });
      onProgress?.(this._uploadProgress());

      // Map results back to UploadResult format
      return result.data.results.map(r => ({
        success: r.success,
        url: r.url,
        error: r.error,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this._uploadProgress.set({ status: 'error', progress: 0, error: errorMessage });
      onProgress?.(this._uploadProgress());
      return files.map(() => ({ success: false, error: errorMessage }));
    } finally {
      // Reset progress after a short delay
      setTimeout(() => {
        this._uploadProgress.set({ status: 'idle', progress: 0 });
      }, 1000);
    }
  }

  /**
   * Delete an image via Cloud Function
   */
  async deleteImage(imageUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const deleteFn = httpsCallable<{ imageUrl: string }, { success: boolean }>(
        this.functions,
        'deleteProfileImage'
      );

      const result = await deleteFn({ imageUrl });
      return { success: result.data.success };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Delete failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Client-side validation for better UX
   * Server will also validate for security
   * Made public so components can validate before attempting upload
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];

    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: 'Please select a valid image (JPEG or PNG)' };
    }

    if (file.size > maxSize) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return { valid: false, error: `Image is too large (${sizeMB}MB). Maximum size is 10MB.` };
    }

    return { valid: true };
  }

  /**
   * Convert file to base64 string
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Create a preview URL for a file (for immediate display)
   */
  createPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to create preview'));
      reader.readAsDataURL(file);
    });
  }
}
