import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  PLATFORM_ID,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

export interface ImagePreview {
  file: File;
  url: string;
}

export interface VideoPreview {
  file: File;
  url: string;
  thumbnailUrl?: string;
  thumbnailBlob?: Blob;
}

export interface TimerOption {
  label: string;
  value: number | null;
}

export interface SendMessageEvent {
  content: string;
  files: File[];
  timer: number | null;
}

export interface SendVideoEvent {
  videoFile: File;
  thumbnailBlob?: Blob;
}

@Component({
  selector: 'app-chat-input',
  templateUrl: './chat-input.html',
  styleUrl: './chat-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule],
})
export class ChatInputComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private viewportResizeHandler: (() => void) | null = null;
  private lastViewportHeight = 0;

  @ViewChild('mediaInput') mediaInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messageInputEl') messageInputEl!: ElementRef<HTMLInputElement>;

  @Input() isBlocked = false;
  @Input() isAiPanelOpen = false;
  @Input() hasAiAccess = false;
  @Input() timerOptions: TimerOption[] = [
    { label: 'MESSAGES.TIMER.NONE', value: null },
    { label: 'MESSAGES.TIMER.FIVE_SEC', value: 5 },
    { label: 'MESSAGES.TIMER.TEN_SEC', value: 10 },
    { label: 'MESSAGES.TIMER.THIRTY_SEC', value: 30 },
    { label: 'MESSAGES.TIMER.ONE_MIN', value: 60 },
  ];

  @Output() messageSent = new EventEmitter<SendMessageEvent>();
  @Output() videoSent = new EventEmitter<SendVideoEvent>();
  @Output() typing = new EventEmitter<void>();
  @Output() aiAssistToggled = new EventEmitter<void>();
  @Output() draftChanged = new EventEmitter<string>();

  protected readonly messageInput = signal('');
  protected readonly selectedImages = signal<ImagePreview[]>([]);
  protected readonly selectedVideo = signal<VideoPreview | null>(null);
  protected readonly videoUploading = signal(false);
  protected readonly imageTimer = signal<number | null>(null);

  // Max video size in bytes (100MB)
  private readonly MAX_VIDEO_SIZE = 100 * 1024 * 1024;

  /**
   * Set message input value programmatically (e.g., from AI assist)
   */
  setMessageInput(value: string): void {
    this.messageInput.set(value);
    this.draftChanged.emit(value);
    this.focusInput();
  }

  /**
   * Focus the message input
   */
  focusInput(): void {
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }

  /**
   * Check if we're on a mobile device (based on screen width)
   */
  private isMobile(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return window.innerWidth < 768;
  }

  protected send(): void {
    const content = this.messageInput().trim();
    const images = this.selectedImages();
    const video = this.selectedVideo();
    const timer = this.imageTimer();
    
    // Handle video separately
    if (video) {
      this.sendVideo();
      return;
    }
    
    // Must have text or images
    if (!content && images.length === 0) return;

    // Capture files BEFORE clearing
    const files = images.map(img => img.file);

    // Clear inputs immediately for responsiveness
    this.messageInput.set('');
    this.clearImages();
    this.imageTimer.set(null);

    // Emit the send event
    this.messageSent.emit({ content, files, timer });
    
    // Refocus the input for continued typing (desktop only)
    // On mobile, avoid refocusing to prevent keyboard hide/show flicker
    if (!this.isMobile()) {
      this.focusInput();
    }
  }

  protected sendVideo(): void {
    const video = this.selectedVideo();
    if (!video) return;

    // Capture video file and thumbnail BEFORE clearing
    const videoFile = video.file;
    const thumbnailBlob = video.thumbnailBlob;

    // Clear video selection immediately for responsiveness
    this.clearVideo();

    // Emit the video send event
    this.videoSent.emit({ videoFile, thumbnailBlob });
    
    // Refocus the input
    if (!this.isMobile()) {
      this.focusInput();
    }
  }

  protected canSend(): boolean {
    return this.messageInput().trim().length > 0 || 
           this.selectedImages().length > 0 || 
           this.selectedVideo() !== null;
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected onInput(): void {
    this.typing.emit();
    this.draftChanged.emit(this.messageInput());
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Use visualViewport API on mobile to detect keyboard open/close
    if (this.isMobile() && window.visualViewport) {
      this.lastViewportHeight = window.visualViewport.height;
      
      this.viewportResizeHandler = () => {
        const viewport = window.visualViewport;
        if (!viewport) return;

        const currentHeight = viewport.height;
        const heightDiff = this.lastViewportHeight - currentHeight;
        
        // Keyboard opened (viewport got smaller by more than 100px)
        if (heightDiff > 100) {
          this.scrollInputIntoView();
        }
        
        this.lastViewportHeight = currentHeight;
      };

      window.visualViewport.addEventListener('resize', this.viewportResizeHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.viewportResizeHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.viewportResizeHandler);
    }
  }

  /**
   * Scroll the input into view - used when keyboard opens
   */
  private scrollInputIntoView(): void {
    // Small delay to let the keyboard finish animating
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }, 100);
  }

  /**
   * Handle input focus - scroll into view on mobile to ensure visibility above keyboard
   */
  protected onFocus(): void {
    if (!this.isMobile()) return;
    
    // Small delay to let the keyboard animate in
    setTimeout(() => {
      this.scrollInputIntoView();
    }, 300);
  }

  /**
   * Handle click on input - needed for when input already has focus but keyboard was dismissed
   */
  protected onClick(): void {
    if (!this.isMobile()) return;
    
    // Scroll into view when clicked (covers case where input has focus but keyboard was dismissed)
    setTimeout(() => {
      this.scrollInputIntoView();
    }, 300);
  }

  protected openMediaPicker(): void {
    this.mediaInput?.nativeElement?.click();
  }

  protected onMediaSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const files = Array.from(input.files);
    
    // Check if any file is a video
    const videoFile = files.find(file => file.type.startsWith('video/'));
    
    if (videoFile) {
      // Handle as video (only one video at a time, clear images)
      this.handleVideoFile(videoFile);
    } else {
      // Handle as images
      this.handleImageFiles(files);
    }
    
    // Reset input so same file can be selected again
    input.value = '';
  }

  private handleImageFiles(files: File[]): void {
    // Clear any selected video first
    this.clearVideo();
    
    const newImages: ImagePreview[] = [];
    const existingImages = this.selectedImages();

    // Limit to 10 images total
    const remaining = 10 - existingImages.length;
    const filesToAdd = files.slice(0, remaining);

    for (const file of filesToAdd) {
      // Only accept images
      if (!file.type.startsWith('image/')) continue;
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      newImages.push({ file, url });
    }

    this.selectedImages.set([...existingImages, ...newImages]);
  }

  private handleVideoFile(file: File): void {
    // Check file size (100MB max)
    if (file.size > this.MAX_VIDEO_SIZE) {
      console.warn('Video file too large (max 100MB)');
      return;
    }

    // Clear any existing images (can't send both)
    this.clearImages();
    this.imageTimer.set(null);

    // Create preview URL
    const url = URL.createObjectURL(file);
    
    // Generate thumbnail from video
    this.generateVideoThumbnail(file).then(({ thumbnailUrl, thumbnailBlob }) => {
      this.selectedVideo.set({ file, url, thumbnailUrl, thumbnailBlob });
    }).catch(() => {
      // If thumbnail generation fails, still allow the video
      this.selectedVideo.set({ file, url });
    });
  }

  protected removeImage(index: number): void {
    const images = this.selectedImages();
    const removed = images[index];
    
    // Revoke the object URL to free memory
    URL.revokeObjectURL(removed.url);
    
    this.selectedImages.set(images.filter((_, i) => i !== index));
  }

  protected clearImages(): void {
    const images = this.selectedImages();
    images.forEach(img => URL.revokeObjectURL(img.url));
    this.selectedImages.set([]);
  }

  /**
   * Generate a thumbnail from a video file
   */
  private generateVideoThumbnail(file: File): Promise<{ thumbnailUrl: string; thumbnailBlob: Blob }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.onloadeddata = () => {
        // Seek to 1 second or 10% of duration, whichever is smaller
        video.currentTime = Math.min(1, video.duration * 0.1);
      };

      video.onseeked = () => {
        // Set canvas size to video dimensions (max 320x180 for thumbnail)
        const maxWidth = 320;
        const maxHeight = 180;
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;

        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            if (blob) {
              const thumbnailUrl = URL.createObjectURL(blob);
              resolve({ thumbnailUrl, thumbnailBlob: blob });
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
            
            // Clean up
            URL.revokeObjectURL(video.src);
          }, 'image/jpeg', 0.8);
        } else {
          reject(new Error('Failed to get canvas context'));
        }
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Failed to load video'));
      };

      video.src = URL.createObjectURL(file);
    });
  }

  protected removeVideo(): void {
    const video = this.selectedVideo();
    if (video) {
      URL.revokeObjectURL(video.url);
      if (video.thumbnailUrl) {
        URL.revokeObjectURL(video.thumbnailUrl);
      }
    }
    this.selectedVideo.set(null);
  }

  protected clearVideo(): void {
    this.removeVideo();
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  protected onTimerChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.imageTimer.set(value === '' ? null : +value);
  }

  protected toggleAiAssist(): void {
    this.aiAssistToggled.emit();
  }
}
