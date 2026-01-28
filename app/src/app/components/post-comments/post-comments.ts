import { ChangeDetectionStrategy, Component, inject, signal, OnInit, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { FeedService } from '../../core/services/feed.service';
import { PostDisplay, CommentDisplay } from '../../core/interfaces';
import { ReputationBadgeComponent } from '../reputation-badge';
import { ImageGalleryComponent, GalleryState } from '../../pages/messages/components/image-gallery';

export interface PostCommentsDialogData {
  post: PostDisplay;
}

const MAX_COMMENT_LENGTH = 280;

@Component({
  selector: 'app-post-comments',
  templateUrl: './post-comments.html',
  styleUrl: './post-comments.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    FormsModule,
    TranslateModule,
    ReputationBadgeComponent,
    ImageGalleryComponent,
  ],
})
export class PostCommentsComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<PostCommentsComponent>);
  private readonly feedService = inject(FeedService);
  protected readonly data = inject<PostCommentsDialogData>(MAT_DIALOG_DATA);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected commentText = '';

  // From feed service
  protected readonly comments = this.feedService.comments;
  protected readonly loading = this.feedService.commentsLoading;

  protected readonly maxCommentLength = MAX_COMMENT_LENGTH;
  
  // Use a getter instead of computed since commentText is not a signal
  protected get canSubmit(): boolean {
    const text = this.commentText.trim();
    return text.length > 0 && text.length <= MAX_COMMENT_LENGTH && !this.submitting();
  }

  /**
   * Check if media item is a video (by type field or URL extension)
   */
  protected isVideoMedia(media: { url: string; type?: string }): boolean {
    if (media.type === 'video') return true;
    // Fallback: check URL extension
    const videoExtensions = ['.mp4', '.webm', '.mov', '.m4v', '.avi'];
    const lowerUrl = media.url.toLowerCase();
    return videoExtensions.some(ext => lowerUrl.includes(ext));
  }

  // Image gallery state
  protected readonly galleryState = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });

  // Get only image URLs (for gallery)
  protected readonly imageUrls = computed(() => {
    const media = this.data.post.content.media || [];
    return media
      .filter(m => !this.isVideoMedia(m))
      .map(m => m.url);
  });

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

  ngOnInit(): void {
    // Subscribe to realtime comments for this post
    this.feedService.subscribeToComments(this.data.post.id);
  }

  protected async submitComment(): Promise<void> {
    const content = this.commentText.trim();
    if (!content || this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);

    try {
      const success = await this.feedService.addComment(this.data.post.id, content);
      if (success) {
        this.commentText = '';
      } else {
        this.error.set('Failed to add comment. Please try again.');
      }
    } catch (err) {
      console.error('Error adding comment:', err);
      this.error.set('Failed to add comment. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  protected async deleteComment(comment: CommentDisplay): Promise<void> {
    if (!comment.isOwn) return;

    try {
      await this.feedService.deleteComment(this.data.post.id, comment.id);
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  }

  protected formatDate(dateInput: Date | string | { _seconds: number; _nanoseconds: number } | unknown): string {
    if (!dateInput) return '';
    
    let date: Date;
    
    // Handle Firebase Timestamp-like objects (serialized from Cloud Functions)
    if (typeof dateInput === 'object' && dateInput !== null && '_seconds' in dateInput) {
      const ts = dateInput as { _seconds: number; _nanoseconds: number };
      date = new Date(ts._seconds * 1000);
    } else if (typeof dateInput === 'string') {
      // Handle ISO string dates
      date = new Date(dateInput);
    } else if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      // Try to convert to date as fallback
      date = new Date(dateInput as string | number);
    }
    
    // Validate the date
    if (isNaN(date.getTime())) return '';
    
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
  }

  protected close(): void {
    this.feedService.clearComments();
    this.dialogRef.close();
  }
}
