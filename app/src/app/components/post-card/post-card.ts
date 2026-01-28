import { ChangeDetectionStrategy, Component, input, output, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { PostDisplay, getTierDisplay, ReputationTier } from '../../core/interfaces';
import { ImageGalleryComponent, GalleryState } from '../../pages/messages/components/image-gallery';

@Component({
  selector: 'app-post-card',
  templateUrl: './post-card.html',
  styleUrl: './post-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    TranslateModule,
    ImageGalleryComponent,
  ],
})
export class PostCardComponent {
  private readonly router = inject(Router);

  // Inputs
  readonly post = input.required<PostDisplay>();
  readonly isDeleting = input(false);

  // Outputs
  readonly likeClick = output<PostDisplay>();
  readonly commentClick = output<PostDisplay>();
  readonly authorClick = output<PostDisplay>();
  readonly deleteClick = output<PostDisplay>();
  readonly reportClick = output<PostDisplay>();

  // Computed
  protected readonly hasMedia = computed(() => (this.post().content.media?.length || 0) > 0);
  protected readonly mediaCount = computed(() => this.post().content.media?.length || 0);
  protected readonly mediaItems = computed(() => {
    const media = this.post().content.media || [];
    // Ensure each media item has a type - infer from URL extension if missing
    return media.map(m => ({
      ...m,
      type: m.type || this.inferMediaType(m.url),
    }));
  });
  protected readonly mediaUrls = computed(() => this.post().content.media?.map(m => m.url) || []);
  protected readonly hasVideo = computed(() => 
    this.mediaItems().some(m => m.type === 'video')
  );

  // Image gallery state
  protected readonly galleryState = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });

  // Get only image URLs (for gallery)
  protected readonly imageUrls = computed(() => 
    this.mediaItems()
      .filter(m => m.type !== 'video')
      .map(m => m.url)
  );

  // Reputation tier display for avatar border
  protected readonly tierDisplay = computed(() => {
    const tier = this.post().author.reputationTier as ReputationTier | undefined;
    if (!tier) return null;
    return getTierDisplay(tier);
  });

  protected readonly avatarBorderColor = computed(() => {
    const display = this.tierDisplay();
    return display?.color || 'transparent';
  });

  protected readonly tierTooltip = computed(() => {
    const display = this.tierDisplay();
    if (!display) return '';
    return `${display.label}: ${display.description}`;
  });

  /**
   * Infer media type from URL extension (fallback for posts without type field)
   */
  private inferMediaType(url: string): 'image' | 'video' {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.m4v', '.avi'];
    const lowerUrl = url.toLowerCase();
    for (const ext of videoExtensions) {
      if (lowerUrl.includes(ext)) {
        return 'video';
      }
    }
    return 'image';
  }
  
  protected readonly likeIcon = computed(() => 
    this.post().isLiked ? 'favorite' : 'favorite_border'
  );

  // Visibility indicator
  protected readonly visibilityIcon = computed(() => {
    switch (this.post().visibility) {
      case 'public': return 'public';
      case 'connections': return 'people';
      case 'private': return 'lock';
      default: return 'public';
    }
  });

  protected readonly visibilityLabel = computed(() => {
    switch (this.post().visibility) {
      case 'public': return 'FEED.VISIBILITY_PUBLIC';
      case 'connections': return 'FEED.VISIBILITY_CONNECTIONS';
      case 'private': return 'FEED.VISIBILITY_PRIVATE';
      default: return 'FEED.VISIBILITY_PUBLIC';
    }
  });

  protected readonly formattedDate = computed(() => {
    const date = this.post().createdAt;
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  protected onLike(): void {
    this.likeClick.emit(this.post());
  }

  protected onComment(): void {
    this.commentClick.emit(this.post());
  }

  protected onAuthorClick(): void {
    this.authorClick.emit(this.post());
  }

  protected onDelete(): void {
    this.deleteClick.emit(this.post());
  }

  protected onReport(): void {
    this.reportClick.emit(this.post());
  }

  protected viewProfile(): void {
    this.router.navigate(['/user', this.post().author.uid]);
  }

  protected openGallery(imageUrl: string): void {
    const images = this.imageUrls();
    const index = images.indexOf(imageUrl);
    this.galleryState.set({
      isOpen: true,
      images,
      currentIndex: index >= 0 ? index : 0,
    });
  }

  protected closeGallery(): void {
    this.galleryState.update(state => ({ ...state, isOpen: false }));
  }

  protected navigateGallery(index: number): void {
    this.galleryState.update(state => ({ ...state, currentIndex: index }));
  }
}
