import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  effect,
  ViewChild,
  ElementRef,
  HostListener,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { CdkScrollable, ScrollingModule } from '@angular/cdk/scrolling';
import { MatMenuModule } from '@angular/material/menu';
import { MessageService } from '../../core/services/message.service';
import { ConversationDisplay, MessageDisplay } from '../../core/interfaces';

interface ImagePreview {
  file: File;
  url: string;
}

interface GalleryState {
  isOpen: boolean;
  images: string[];
  currentIndex: number;
}

@Component({
  selector: 'app-messages',
  templateUrl: './messages.html',
  styleUrl: './messages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollingModule, MatMenuModule, NgOptimizedImage],
})
export class MessagesComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly messageService = inject(MessageService);

  @ViewChild(CdkScrollable) scrollable!: CdkScrollable;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  protected readonly messageInput = signal('');
  protected readonly selectedImages = signal<ImagePreview[]>([]);
  protected readonly gallery = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });
  private isNearBottom = true;
  private previousMessageCount = 0;
  private conversationIdFromRoute: string | null = null;

  // Expose service signals
  protected readonly conversations = this.messageService.conversations;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly messages = this.messageService.messages;
  protected readonly loading = this.messageService.loading;
  protected readonly sending = this.messageService.sending;
  protected readonly isOtherUserTyping = this.messageService.isOtherUserTyping;

  constructor() {
    // Watch for conversations to load, then open the one from route if specified
    effect(() => {
      const convos = this.conversations();
      if (this.conversationIdFromRoute && convos.length > 0 && !this.activeConversation()) {
        const targetConvo = convos.find(c => c.id === this.conversationIdFromRoute);
        if (targetConvo) {
          this.previousMessageCount = 0; // Reset for initial scroll
          this.isNearBottom = true;
          this.messageService.openConversation(targetConvo);
        }
      }
    });

    // Watch for new messages and auto-scroll after DOM renders
    effect(() => {
      const messages = this.messages();
      const currentCount = messages.length;
      
      if (currentCount > this.previousMessageCount) {
        // Initial load (first batch of messages) - always scroll to bottom
        // Subsequent messages - only scroll if user is near bottom
        if (this.previousMessageCount === 0 || this.isNearBottom) {
          // Use setTimeout to wait for DOM to render the new messages
          setTimeout(() => this.scrollToBottom(), 0);
        }
      }
      this.previousMessageCount = currentCount;
    });

    // Watch for typing indicator and scroll if near bottom
    effect(() => {
      const isTyping = this.isOtherUserTyping();
      if (isTyping && this.isNearBottom) {
        setTimeout(() => this.scrollToBottom(), 0);
      }
    });
  }

  ngOnInit(): void {
    // Check for conversationId in route params
    this.conversationIdFromRoute = this.route.snapshot.paramMap.get('conversationId');
  }

  ngOnDestroy(): void {
    // Close any open conversation when leaving messages
    this.messageService.closeConversation();
  }

  protected openConversation(conversation: ConversationDisplay): void {
    this.previousMessageCount = 0; // Reset so initial load scrolls to bottom
    this.isNearBottom = true;
    this.messageService.openConversation(conversation);
    // Update URL to include conversation ID
    this.router.navigate(['/messages', conversation.id], { replaceUrl: true });
  }

  protected closeConversation(): void {
    this.messageService.closeConversation();
    // Navigate back to messages list
    this.router.navigate(['/messages'], { replaceUrl: true });
  }

  /**
   * Send message with optional text and/or images
   */
  protected async send(): Promise<void> {
    const content = this.messageInput().trim();
    const images = this.selectedImages();
    
    // Must have text or images
    if (!content && images.length === 0) return;

    // Capture files BEFORE clearing
    const files = images.map(img => img.file);

    // Clear inputs immediately for responsiveness
    this.messageInput.set('');
    this.clearImages();
    this.isNearBottom = true;

    await this.messageService.sendMessage(content, files);
  }

  /**
   * Check if send button should be enabled
   */
  protected canSend(): boolean {
    return this.messageInput().trim().length > 0 || this.selectedImages().length > 0;
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected onInput(): void {
    // Notify that the user is typing
    this.messageService.setTyping(true);
  }

  /**
   * Open file picker for images
   */
  protected openImagePicker(): void {
    this.fileInput?.nativeElement?.click();
  }

  /**
   * Handle file selection from input
   */
  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const newImages: ImagePreview[] = [];
    const existingImages = this.selectedImages();

    // Limit to 10 images total
    const remaining = 10 - existingImages.length;
    const filesToAdd = Array.from(input.files).slice(0, remaining);

    for (const file of filesToAdd) {
      // Only accept images
      if (!file.type.startsWith('image/')) continue;
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      newImages.push({ file, url });
    }

    this.selectedImages.set([...existingImages, ...newImages]);
    
    // Reset input so same file can be selected again
    input.value = '';
  }

  /**
   * Remove an image from selection
   */
  protected removeImage(index: number): void {
    const images = this.selectedImages();
    const removed = images[index];
    
    // Revoke the object URL to free memory
    URL.revokeObjectURL(removed.url);
    
    this.selectedImages.set(images.filter((_, i) => i !== index));
  }

  /**
   * Clear all selected images
   */
  protected clearImages(): void {
    const images = this.selectedImages();
    images.forEach(img => URL.revokeObjectURL(img.url));
    this.selectedImages.set([]);
  }

  // ============================================
  // IMAGE GALLERY
  // ============================================

  /**
   * Open the image gallery at a specific image
   */
  protected openGallery(images: string[], startIndex: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.gallery.set({
      isOpen: true,
      images,
      currentIndex: startIndex,
    });
  }

  /**
   * Close the image gallery
   */
  protected closeGallery(): void {
    this.gallery.update(g => ({ ...g, isOpen: false }));
  }

  /**
   * Navigate to the previous image
   */
  protected prevImage(): void {
    this.gallery.update(g => ({
      ...g,
      currentIndex: g.currentIndex > 0 ? g.currentIndex - 1 : g.images.length - 1,
    }));
  }

  /**
   * Navigate to the next image
   */
  protected nextImage(): void {
    this.gallery.update(g => ({
      ...g,
      currentIndex: g.currentIndex < g.images.length - 1 ? g.currentIndex + 1 : 0,
    }));
  }

  /**
   * Go to a specific image by index
   */
  protected goToImage(index: number): void {
    this.gallery.update(g => ({ ...g, currentIndex: index }));
  }

  /**
   * Handle keyboard navigation for gallery
   */
  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.gallery().isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.closeGallery();
        break;
      case 'ArrowLeft':
        this.prevImage();
        break;
      case 'ArrowRight':
        this.nextImage();
        break;
    }
  }

  // ============================================
  // MESSAGE DELETION
  // ============================================

  /**
   * Delete a message for the current user only
   */
  protected async deleteForMe(message: MessageDisplay): Promise<void> {
    await this.messageService.deleteMessageForMe(message.id);
  }

  /**
   * Delete a message for everyone (sender only)
   */
  protected async deleteForEveryone(message: MessageDisplay): Promise<void> {
    if (!message.isOwn) return;
    await this.messageService.deleteMessageForEveryone(message.id);
  }

  protected formatTime(date: Date | null): string {
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  protected formatMessageTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Handle scroll events to track if user is near bottom
   */
  protected onScroll(): void {
    this.isNearBottom = this.checkIfNearBottom();
  }

  /**
   * Check if scroll position is within threshold of bottom
   */
  private checkIfNearBottom(): boolean {
    if (!this.scrollable) return true;
    
    const element = this.scrollable.getElementRef().nativeElement;
    const threshold = 100; // pixels from bottom to consider "near"
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    
    return distanceFromBottom <= threshold;
  }

  private scrollToBottom(): void {
    if (this.scrollable) {
      const element = this.scrollable.getElementRef().nativeElement;
      element.scrollTop = element.scrollHeight;
      this.isNearBottom = true;
    }
  }
}
