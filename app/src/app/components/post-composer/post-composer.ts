import { ChangeDetectionStrategy, Component, inject, output, signal, computed, input, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FeedService, FeedTab } from '../../core/services/feed.service';
import { AuthService } from '../../core/services/auth.service';
import { ImageUploadService, MediaType } from '../../core/services/image-upload.service';
import { PostVisibility, CreatePostRequest, PostMedia, LinkPreview } from '../../core/interfaces';

const MAX_CONTENT_LENGTH = 500;
const MAX_MEDIA = 4;
const MAX_VIDEOS = 1; // Only 1 video allowed per post

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

interface MediaItem {
  file: File;
  preview: string;
  type: MediaType;
  thumbnailBlob?: Blob; // For videos
  thumbnailUrl?: string; // For video thumbnail preview
}

interface VisibilityOption {
  value: PostVisibility;
  labelKey: string;
  icon: string;
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { value: 'public', labelKey: 'FEED.VISIBILITY.PUBLIC', icon: 'public' },
  { value: 'matches', labelKey: 'FEED.VISIBILITY.MATCHES', icon: 'people' },
  { value: 'private', labelKey: 'FEED.VISIBILITY.PRIVATE', icon: 'lock' },
];

@Component({
  selector: 'app-post-composer',
  templateUrl: './post-composer.html',
  styleUrl: './post-composer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    TranslateModule,
  ],
})
export class PostComposerComponent {
  private readonly feedService = inject(FeedService);
  private readonly authService = inject(AuthService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly functions = inject(Functions);

  // Inputs
  readonly activeTab = input<FeedTab>('feed');

  // Outputs
  readonly postCreated = output<void>();

  // State
  protected readonly content = signal('');
  protected readonly media = signal<MediaItem[]>([]);
  protected readonly visibility = signal<PostVisibility>('public');
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  
  // Link preview state
  protected readonly linkPreview = signal<LinkPreview | null>(null);
  protected readonly loadingPreview = signal(false);
  private lastDetectedUrl: string | null = null;

  // Constants
  protected readonly maxContentLength = MAX_CONTENT_LENGTH;
  protected readonly maxMedia = MAX_MEDIA;
  protected readonly allVisibilityOptions = VISIBILITY_OPTIONS;

  // Filter visibility options based on active tab
  protected readonly visibilityOptions = computed(() => {
    if (this.activeTab() === 'private') {
      // On private tab, only private visibility is available
      return this.allVisibilityOptions.filter(o => o.value === 'private');
    }
    // On feed tab, public and matches only
    return this.allVisibilityOptions.filter(o => o.value !== 'private');
  });

  // Track if we're in private mode
  protected readonly isPrivateMode = computed(() => this.activeTab() === 'private');

  constructor() {
    // Sync visibility with tab changes
    effect(() => {
      const tab = this.activeTab();
      if (tab === 'private') {
        this.visibility.set('private');
      } else if (this.visibility() === 'private') {
        // If switching from private tab, reset to public
        this.visibility.set('public');
      }
    });
  }

  // Computed
  protected readonly creating = this.feedService.creating;
  
  protected readonly hasVideo = computed(() => 
    this.media().some(m => m.type === 'video')
  );
  
  // Videos are only allowed on private posts
  protected readonly videoOnNonPrivate = computed(() => 
    this.hasVideo() && this.visibility() !== 'private'
  );
  
  // File accept types - only include video on private posts
  protected readonly acceptedFileTypes = computed(() => {
    const imageTypes = 'image/jpeg,image/png,image/jpg';
    const videoTypes = 'video/mp4,video/webm,video/quicktime';
    return this.visibility() === 'private' 
      ? `${imageTypes},${videoTypes}` 
      : imageTypes;
  });
  
  protected readonly isValid = computed(() => {
    const text = this.content().trim();
    const hasMedia = this.media().length > 0;
    const basicValid = (text.length > 0 || hasMedia) && text.length <= MAX_CONTENT_LENGTH;
    // Invalid if video on non-private post
    return basicValid && !this.videoOnNonPrivate();
  });

  protected readonly remainingChars = computed(() => MAX_CONTENT_LENGTH - this.content().length);
  protected readonly charCountClass = computed(() => {
    const remaining = this.remainingChars();
    if (remaining < 0) return 'over';
    if (remaining < 50) return 'warning';
    return '';
  });

  protected readonly selectedVisibility = computed(() => 
    this.visibilityOptions().find(o => o.value === this.visibility()) || this.visibilityOptions()[0]
  );

  protected readonly userPhoto = computed(() => this.authService.user()?.photoURL);

  protected onContentChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.content.set(target.value);
    this.detectAndFetchLinkPreview(target.value);
  }

  /**
   * Detect URLs in text and fetch preview for the first one
   */
  private detectAndFetchLinkPreview(text: string): void {
    // Don't detect if we already have a preview
    if (this.linkPreview()) return;

    const matches = text.match(URL_REGEX);
    if (!matches || matches.length === 0) return;

    const url = matches[0];
    
    // Don't refetch the same URL
    if (url === this.lastDetectedUrl) return;
    this.lastDetectedUrl = url;

    this.fetchLinkPreview(url);
  }

  /**
   * Fetch link preview from backend
   */
  private async fetchLinkPreview(url: string): Promise<void> {
    this.loadingPreview.set(true);
    
    try {
      const fetchPreviewFn = httpsCallable<{url: string}, {success: boolean; preview?: LinkPreview}>(
        this.functions,
        'fetchLinkPreview'
      );
      
      const result = await fetchPreviewFn({ url });
      
      if (result.data.success && result.data.preview) {
        this.linkPreview.set(result.data.preview);
      }
    } catch (err) {
      console.warn('Failed to fetch link preview:', err);
      // Silently fail - link previews are optional
    } finally {
      this.loadingPreview.set(false);
    }
  }

  /**
   * Remove the link preview
   */
  protected removeLinkPreview(): void {
    this.linkPreview.set(null);
    this.lastDetectedUrl = null;
  }

  protected async onMediaSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const currentCount = this.media().length;
    const remaining = MAX_MEDIA - currentCount;
    if (remaining <= 0) return;

    const files = Array.from(input.files).slice(0, remaining);
    
    for (const file of files) {
      // Validate file
      const validation = this.imageUploadService.validateFile(file);
      if (!validation.valid) {
        this.error.set(validation.error || 'Invalid file');
        continue;
      }

      const isVideo = this.imageUploadService.isVideoFile(file);
      
      // Only allow 1 video per post
      if (isVideo && this.hasVideo()) {
        this.error.set('Only one video is allowed per post');
        continue;
      }
      
      // Videos are only allowed on private posts
      if (isVideo && this.visibility() !== 'private') {
        this.error.set('Videos can only be shared in private posts');
        continue;
      }
      
      // Create preview
      const preview = URL.createObjectURL(file);
      const mediaType: MediaType = isVideo ? 'video' : 'image';

      if (isVideo) {
        // Generate thumbnail for video
        try {
          const { thumbnailUrl, thumbnailBlob } = await this.imageUploadService.generateVideoThumbnail(file);
          this.media.update(media => [...media, { 
            file, 
            preview, 
            type: mediaType,
            thumbnailBlob,
            thumbnailUrl,
          }]);
        } catch (err) {
          console.warn('Failed to generate video thumbnail:', err);
          // Still add the video, just without a thumbnail
          this.media.update(media => [...media, { file, preview, type: mediaType }]);
        }
      } else {
        this.media.update(media => [...media, { file, preview, type: mediaType }]);
      }
    }

    // Reset input
    input.value = '';
  }

  protected removeMedia(index: number): void {
    const item = this.media()[index];
    if (item) {
      URL.revokeObjectURL(item.preview);
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    }
    this.media.update(media => media.filter((_, i) => i !== index));
  }

  protected setVisibility(value: PostVisibility): void {
    this.visibility.set(value);
  }

  protected async createPost(): Promise<void> {
    if (!this.isValid() || this.creating()) return;

    this.error.set(null);

    // Upload media if any - videos and images are uploaded separately
    let uploadedMedia: PostMedia[] = [];
    if (this.media().length > 0) {
      this.uploading.set(true);
      try {
        const mediaItems = this.media();
        const imageItems = mediaItems.filter(m => m.type === 'image');
        const videoItems = mediaItems.filter(m => m.type === 'video');

        // Upload images using batch upload
        if (imageItems.length > 0) {
          const imageFiles = imageItems.map(m => m.file);
          const imageResults = await this.imageUploadService.uploadImages(
            imageFiles, 
            'feed', 
            undefined,
            this.visibility()
          );
          
          const failedImages = imageResults.filter(r => !r.success);
          if (failedImages.length > 0) {
            const errorMessage = failedImages[0].error || 'Failed to upload images.';
            this.error.set(errorMessage);
            this.uploading.set(false);
            return;
          }
          
          uploadedMedia.push(...imageResults.map(r => ({ 
            url: r.url!,
            type: 'image' as const,
          })));
        }

        // Upload videos using dedicated video upload (with thumbnails)
        for (const videoItem of videoItems) {
          const videoResult = await this.imageUploadService.uploadFeedVideo(
            videoItem.file,
            videoItem.thumbnailBlob,
            this.visibility()
          );
          
          if (!videoResult.success) {
            const errorMessage = videoResult.error || 'Failed to upload video.';
            this.error.set(errorMessage);
            this.uploading.set(false);
            return;
          }
          
          uploadedMedia.push({
            url: videoResult.url!,
            type: 'video',
            thumbUrl: videoResult.thumbUrl,
          });
        }
      } catch (err) {
        console.error('Failed to upload media:', err);
        this.error.set('Failed to upload media. Please try again.');
        this.uploading.set(false);
        return;
      }
      this.uploading.set(false);
    }

    // Determine content type
    const hasVideo = uploadedMedia.some(m => m.type === 'video');
    const contentType = uploadedMedia.length > 0 
      ? (hasVideo ? 'video' : 'image') 
      : 'text';

    // Create post
    const request: CreatePostRequest = {
      content: {
        type: contentType,
        text: this.content().trim() || undefined,
        media: uploadedMedia.length > 0 ? uploadedMedia : undefined,
        linkPreview: this.linkPreview() || undefined,
      },
      visibility: this.visibility(),
    };

    const result = await this.feedService.createPost(request);
    
    if (result.success) {
      // Clear form and revoke all URLs
      this.content.set('');
      this.media().forEach(m => {
        URL.revokeObjectURL(m.preview);
        if (m.thumbnailUrl) {
          URL.revokeObjectURL(m.thumbnailUrl);
        }
      });
      this.media.set([]);
      // Reset visibility based on current tab
      this.visibility.set(this.activeTab() === 'private' ? 'private' : 'public');
      this.linkPreview.set(null);
      this.lastDetectedUrl = null;
      
      this.postCreated.emit();
    } else {
      this.error.set(result.error || 'Failed to create post');
    }
  }

  protected onFocus(): void {
    // Could expand the composer on focus
  }
}
