import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  effect,
  ViewChild,
  ElementRef,
  HostListener,
} from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { CdkScrollable, ScrollingModule } from '@angular/cdk/scrolling';
import { MatMenuModule } from '@angular/material/menu';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { MessageService, ConversationFilter } from '../../core/services/message.service';
import { BlockService } from '../../core/services/block.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AiChatService } from '../../core/services/ai-chat.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ConversationDisplay, MessageDisplay, VirtualPhone, VirtualPhoneSettings } from '../../core/interfaces';
import { AiAssistPanelComponent, AiAssistContext } from '../../components/ai-assist-panel';

interface ImagePreview {
  file: File;
  url: string;
}

interface GalleryState {
  isOpen: boolean;
  images: string[];
  currentIndex: number;
  messageId?: string;
  isTimed?: boolean;
  isExpired?: boolean;
}

@Component({
  selector: 'app-messages',
  templateUrl: './messages.html',
  styleUrl: './messages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollingModule, MatMenuModule, NgOptimizedImage, RouterLink, AiAssistPanelComponent],
})
export class MessagesComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly messageService = inject(MessageService);
  private readonly blockService = inject(BlockService);
  protected readonly subscriptionService = inject(SubscriptionService);
  protected readonly aiChatService = inject(AiChatService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly auth = inject(Auth);

  @ViewChild(CdkScrollable) scrollable!: CdkScrollable;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messageInputEl') messageInputEl!: ElementRef<HTMLInputElement>;

  protected readonly messageInput = signal('');
  protected readonly selectedImages = signal<ImagePreview[]>([]);
  protected readonly imageTimer = signal<number | null>(null); // Duration in seconds for timed images
  protected readonly gallery = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });
  protected readonly galleryCountdown = signal<number | null>(null); // Countdown for timed images in gallery
  protected readonly senderCountdowns = signal<Map<string, number>>(new Map()); // Live countdowns for sender's timed images
  protected readonly recipientCountdowns = signal<Map<string, number>>(new Map()); // Live countdowns for recipient's viewed images
  private galleryCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private senderCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private recipientCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private isNearBottom = true;
  private previousMessageCount = 0;
  private conversationIdFromRoute: string | null = null;

  // Timer options for timed images
  protected readonly timerOptions = [
    { label: 'No timer', value: null },
    { label: '5 sec', value: 5 },
    { label: '10 sec', value: 10 },
    { label: '30 sec', value: 30 },
    { label: '1 min', value: 60 },
  ];

  // Expose service signals
  protected readonly conversations = this.messageService.filteredConversations;
  protected readonly allConversations = this.messageService.conversations;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly messages = this.messageService.messages;
  protected readonly loading = this.messageService.loading;
  protected readonly sending = this.messageService.sending;
  protected readonly isOtherUserTyping = this.messageService.isOtherUserTyping;
  protected readonly conversationFilter = this.messageService.conversationFilter;
  protected readonly otherUserStatus = this.messageService.otherUserStatus;
  protected readonly totalUnreadCount = this.messageService.totalUnreadCount;
  protected readonly archivedCount = this.messageService.archivedCount;
  
  // Check if the other user in the active conversation is blocked
  protected readonly isOtherUserBlocked = computed(() => {
    const convo = this.activeConversation();
    if (!convo?.otherUser?.uid) return false;
    return this.blockService.isUserBlocked(convo.otherUser.uid);
  });

  // AI Assist panel state
  protected readonly isAiPanelOpen = this.aiChatService.isOpen;
  protected readonly hasAiAccess = this.aiChatService.hasAccess;

  // Virtual Phone state (Elite feature)
  protected readonly virtualPhone = signal<VirtualPhone | null>(null);
  protected readonly virtualPhoneLoading = signal(false);
  protected readonly virtualPhoneProvisioning = signal(false);
  protected readonly virtualPhoneError = signal<string | null>(null);
  protected readonly copiedNumber = signal(false);
  protected readonly showVirtualPhoneSettings = signal(false);

  // Check if user has a verified phone number (required for virtual phone)
  protected readonly hasVerifiedPhone = computed(() => {
    const profile = this.userProfileService.profile();
    return profile?.phoneNumberVerified === true && !!profile?.phoneNumber;
  });

  // Computed context for AI assist panel
  protected readonly aiAssistContext = computed((): AiAssistContext | null => {
    const convo = this.activeConversation();
    if (!convo) return null;

    const userProfile = this.userProfileService.profile();
    
    return {
      conversationId: convo.id,
      recipientId: convo.otherUser.uid,
      recipientProfile: {
        displayName: convo.otherUser.displayName || undefined,
      },
      userProfile: userProfile ? {
        displayName: userProfile.displayName || undefined,
        tagline: userProfile.onboarding?.tagline,
      } : undefined,
      recentMessages: this.messages(),
      userDraft: this.messageInput(),
      isEmptyThread: this.messages().length === 0,
    };
  });

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
          // Scroll after DOM renders, with extra delay for aspect-ratio layout calculation
          setTimeout(() => this.scrollToBottom(), 0);
          setTimeout(() => this.scrollToBottom(), 100);
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

    // Watch for messages with active sender countdowns
    effect(() => {
      const messages = this.messages();
      const activeTimedMessages = messages.filter(m => 
        m.isOwn && m.imageTimer && m.isRecipientViewing && m.recipientViewedAt
      );
      
      if (activeTimedMessages.length > 0) {
        this.startSenderCountdowns(activeTimedMessages);
      } else {
        this.stopSenderCountdowns();
      }
    });

    // Watch for recipient's viewed timed images to track expiration
    effect(() => {
      const messages = this.messages();
      const viewedTimedMessages = messages.filter(m => 
        !m.isOwn && m.imageTimer && m.imageViewedAt && !m.isImageExpired
      );
      
      if (viewedTimedMessages.length > 0) {
        this.startRecipientCountdowns(viewedTimedMessages);
      } else {
        this.stopRecipientCountdowns();
      }
    });

    // Watch for Elite status to load virtual phone
    // This handles the case where subscription loads after component init
    effect(() => {
      const isElite = this.subscriptionService.isElite();
      if (isElite && !this.virtualPhone() && !this.virtualPhoneLoading() && !this.virtualPhoneLoadAttempted) {
        this.virtualPhoneLoadAttempted = true;
        this.loadVirtualPhone();
      }
    });
  }

  // Flag to prevent multiple load attempts
  private virtualPhoneLoadAttempted = false;

  ngOnInit(): void {
    // Check for conversationId in route params
    this.conversationIdFromRoute = this.route.snapshot.paramMap.get('conversationId');
  }

  ngOnDestroy(): void {
    // Close any open conversation when leaving messages
    this.messageService.closeConversation();
    this.stopSenderCountdowns();
    this.stopRecipientCountdowns();
  }

  /**
   * Start live countdown for sender's timed images being viewed
   */
  private startSenderCountdowns(messages: MessageDisplay[]): void {
    // Update immediately
    this.updateSenderCountdowns(messages);
    
    // Start interval if not already running
    if (!this.senderCountdownInterval) {
      this.senderCountdownInterval = setInterval(() => {
        const currentMessages = this.messages().filter(m => 
          m.isOwn && m.imageTimer && m.isRecipientViewing && m.recipientViewedAt
        );
        if (currentMessages.length > 0) {
          this.updateSenderCountdowns(currentMessages);
        } else {
          this.stopSenderCountdowns();
        }
      }, 1000);
    }
  }

  /**
   * Update the countdown values for sender's timed images
   */
  private updateSenderCountdowns(messages: MessageDisplay[]): void {
    const countdowns = new Map<string, number>();
    const now = Date.now();
    
    for (const msg of messages) {
      if (msg.recipientViewedAt && msg.imageTimer) {
        const elapsed = (now - msg.recipientViewedAt.getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(msg.imageTimer - elapsed));
        countdowns.set(msg.id, remaining);
      }
    }
    
    this.senderCountdowns.set(countdowns);
  }

  /**
   * Stop the sender countdown interval
   */
  private stopSenderCountdowns(): void {
    if (this.senderCountdownInterval) {
      clearInterval(this.senderCountdownInterval);
      this.senderCountdownInterval = null;
    }
    this.senderCountdowns.set(new Map());
  }

  /**
   * Get the countdown for a specific message (for template)
   */
  protected getSenderCountdown(messageId: string): number | null {
    return this.senderCountdowns().get(messageId) ?? null;
  }

  /**
   * Start live countdown for recipient's viewed timed images
   */
  private startRecipientCountdowns(messages: MessageDisplay[]): void {
    this.updateRecipientCountdowns(messages);
    
    if (!this.recipientCountdownInterval) {
      this.recipientCountdownInterval = setInterval(() => {
        const currentMessages = this.messages().filter(m => 
          !m.isOwn && m.imageTimer && m.imageViewedAt && !m.isImageExpired
        );
        if (currentMessages.length > 0) {
          this.updateRecipientCountdowns(currentMessages);
        } else {
          this.stopRecipientCountdowns();
        }
      }, 1000);
    }
  }

  /**
   * Update the countdown values for recipient's viewed images
   */
  private updateRecipientCountdowns(messages: MessageDisplay[]): void {
    const countdowns = new Map<string, number>();
    const now = Date.now();
    
    for (const msg of messages) {
      if (msg.imageViewedAt && msg.imageTimer) {
        const elapsed = (now - msg.imageViewedAt.getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(msg.imageTimer - elapsed));
        countdowns.set(msg.id, remaining);
      }
    }
    
    this.recipientCountdowns.set(countdowns);
  }

  /**
   * Stop the recipient countdown interval
   */
  private stopRecipientCountdowns(): void {
    if (this.recipientCountdownInterval) {
      clearInterval(this.recipientCountdownInterval);
      this.recipientCountdownInterval = null;
    }
    this.recipientCountdowns.set(new Map());
  }

  /**
   * Get the recipient countdown for a specific message
   */
  protected getRecipientCountdown(messageId: string): number | null {
    return this.recipientCountdowns().get(messageId) ?? null;
  }

  /**
   * Check if a timed image has expired for the recipient (real-time)
   */
  protected isTimedImageExpired(message: MessageDisplay): boolean {
    if (!message.imageTimer || message.isOwn) return false;
    if (message.isImageExpired) return true;
    
    // Check real-time countdown
    const countdown = this.recipientCountdowns().get(message.id);
    return countdown !== undefined && countdown <= 0;
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

  protected setFilter(filter: ConversationFilter): void {
    this.messageService.setConversationFilter(filter);
  }

  protected viewOtherUserProfile(): void {
    const activeConvo = this.activeConversation();
    if (!activeConvo?.otherUser?.uid) return;
    
    this.router.navigate(['/user', activeConvo.otherUser.uid]);
  }

  protected async archiveActiveConversation(): Promise<void> {
    const activeConvo = this.activeConversation();
    if (!activeConvo) return;
    
    await this.messageService.archiveConversation(activeConvo.id);
    this.closeConversation();
  }

  protected async unarchiveActiveConversation(): Promise<void> {
    const activeConvo = this.activeConversation();
    if (!activeConvo) return;
    
    await this.messageService.unarchiveConversation(activeConvo.id);
  }

  protected getStatusText(): string {
    const status = this.otherUserStatus();
    if (!status) return '';
    
    if (status.isOnline) {
      return 'Active now';
    }
    
    if (status.lastActiveAt) {
      return this.messageService.formatLastActive(status.lastActiveAt);
    }
    
    return '';
  }

  /**
   * Send message with optional text and/or images
   */
  protected async send(): Promise<void> {
    const content = this.messageInput().trim();
    const images = this.selectedImages();
    const timer = this.imageTimer();
    
    // Must have text or images
    if (!content && images.length === 0) return;

    // Capture files BEFORE clearing
    const files = images.map(img => img.file);

    // Clear inputs immediately for responsiveness
    this.messageInput.set('');
    this.clearImages();
    this.imageTimer.set(null);
    this.isNearBottom = true;

    await this.messageService.sendMessage(content, files, timer ?? undefined);
    
    // Refocus the input for continued typing (use setTimeout to ensure DOM is ready)
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }

  /**
   * Check if send button should be enabled
   */
  protected canSend(): boolean {
    return this.messageInput().trim().length > 0 || this.selectedImages().length > 0;
  }

  protected async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await this.send();
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
  protected async openGallery(images: string[], startIndex: number, event: Event, message?: MessageDisplay): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    // Check if this is a timed image that has expired
    if (message?.imageTimer && message.isImageExpired && !message.isOwn) {
      // Image has expired, don't open gallery
      return;
    }

    this.gallery.set({
      isOpen: true,
      images,
      currentIndex: startIndex,
      messageId: message?.id,
      isTimed: !!message?.imageTimer && !message?.isOwn,
      isExpired: false,
    });

    // If this is a timed image and the user hasn't viewed it yet, mark as viewed
    if (message?.imageTimer && !message.imageViewedAt && !message.isOwn) {
      await this.messageService.markImageAsViewed(message.id);
      // Start countdown from the full timer duration
      this.startGalleryCountdown(message.imageTimer);
    } else if (message?.imageTimer && message.imageViewedAt && !message.isOwn) {
      // Already viewed, calculate remaining time
      const elapsed = (Date.now() - message.imageViewedAt.getTime()) / 1000;
      const remaining = Math.max(0, message.imageTimer - elapsed);
      if (remaining > 0) {
        this.startGalleryCountdown(remaining);
      } else {
        // Timer already expired
        this.gallery.update(g => ({ ...g, isExpired: true }));
      }
    }
  }

  /**
   * Start the countdown timer for timed images
   */
  private startGalleryCountdown(seconds: number): void {
    this.stopGalleryCountdown();
    this.galleryCountdown.set(Math.ceil(seconds));
    
    this.galleryCountdownInterval = setInterval(() => {
      const current = this.galleryCountdown();
      if (current !== null && current > 0) {
        this.galleryCountdown.set(current - 1);
      } else {
        this.stopGalleryCountdown();
        this.gallery.update(g => ({ ...g, isExpired: true }));
      }
    }, 1000);
  }

  /**
   * Stop the countdown timer
   */
  private stopGalleryCountdown(): void {
    if (this.galleryCountdownInterval) {
      clearInterval(this.galleryCountdownInterval);
      this.galleryCountdownInterval = null;
    }
    this.galleryCountdown.set(null);
  }

  /**
   * Close the image gallery
   */
  protected closeGallery(): void {
    this.stopGalleryCountdown();
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

  // ============================================
  // AI ASSIST
  // ============================================

  /**
   * Toggle the AI assist panel
   */
  protected toggleAiAssist(): void {
    this.aiChatService.toggle();
  }

  /**
   * Handle text insertion from AI assist panel
   */
  protected onAiInsertText(text: string): void {
    this.messageInput.set(text);
    // Focus the input
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }

  /**
   * Handle AI panel close
   */
  protected onAiPanelClosed(): void {
    // Optional: focus back on message input
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }

  // ============================================
  // VIRTUAL PHONE (Elite Feature)
  // ============================================

  private async loadVirtualPhone(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;

    this.virtualPhoneLoading.set(true);
    try {
      const privateDataRef = doc(this.firestore, 'users', user.uid, 'private', 'virtualPhone');
      const snapshot = await getDoc(privateDataRef);
      
      if (snapshot.exists()) {
        this.virtualPhone.set(snapshot.data() as VirtualPhone);
      }
    } catch (error) {
      console.error('Failed to load virtual phone:', error);
    } finally {
      this.virtualPhoneLoading.set(false);
    }
  }

  protected formatPhoneNumber(phone: string): string {
    // Format E.164 number to readable format
    // +12125551234 -> (212) 555-1234
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const area = cleaned.slice(1, 4);
      const prefix = cleaned.slice(4, 7);
      const line = cleaned.slice(7);
      return `(${area}) ${prefix}-${line}`;
    }
    return phone;
  }

  protected async copyVirtualNumber(): Promise<void> {
    const phone = this.virtualPhone();
    if (!phone?.number) return;

    try {
      await navigator.clipboard.writeText(phone.number);
      this.copiedNumber.set(true);
      setTimeout(() => this.copiedNumber.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy number:', error);
    }
  }

  protected openVirtualPhoneSettings(): void {
    this.virtualPhoneError.set(null);
    this.showVirtualPhoneSettings.set(true);
  }

  protected closeVirtualPhoneSettings(): void {
    this.showVirtualPhoneSettings.set(false);
    this.virtualPhoneError.set(null);
  }

  protected async provisionVirtualNumber(): Promise<void> {
    this.virtualPhoneProvisioning.set(true);
    this.virtualPhoneError.set(null);

    try {
      const provisionFn = httpsCallable<void, VirtualPhone>(this.functions, 'provisionVirtualNumber');
      const result = await provisionFn();
      this.virtualPhone.set(result.data);
    } catch (error: any) {
      console.error('Failed to provision virtual number:', error);
      this.virtualPhoneError.set(
        error?.message || 'Failed to get your virtual number. Please try again.'
      );
    } finally {
      this.virtualPhoneProvisioning.set(false);
    }
  }

  /**
   * Show upgrade dialog for non-Elite users trying to get a virtual number
   */
  protected showVirtualPhoneUpgrade(): void {
    // Use subscription service to show upgrade dialog
    // The 'hasVirtualPhone' capability is Elite-only
    this.subscriptionService.canPerformAction('hasVirtualPhone', true);
  }

  protected async updateVirtualPhoneSetting(
    key: keyof VirtualPhoneSettings,
    value: boolean
  ): Promise<void> {
    const user = this.auth.currentUser;
    const phone = this.virtualPhone();
    if (!user || !phone) return;

    // Optimistic update
    const updatedSettings: VirtualPhoneSettings = {
      ...phone.settings,
      [key]: value,
    };
    this.virtualPhone.set({ ...phone, settings: updatedSettings });

    try {
      const privateDataRef = doc(this.firestore, 'users', user.uid, 'private', 'virtualPhone');
      await updateDoc(privateDataRef, {
        [`settings.${key}`]: value,
      });
    } catch (error) {
      console.error('Failed to update virtual phone setting:', error);
      // Revert on error
      this.virtualPhone.set(phone);
    }
  }

  protected async releaseVirtualNumber(): Promise<void> {
    this.virtualPhoneProvisioning.set(true);
    this.virtualPhoneError.set(null);

    try {
      const releaseFn = httpsCallable(this.functions, 'releaseVirtualNumber');
      await releaseFn();
      this.virtualPhone.set(null);
      this.closeVirtualPhoneSettings();
    } catch (error: any) {
      console.error('Failed to release virtual number:', error);
      this.virtualPhoneError.set(
        error?.message || 'Failed to release number. Please try again.'
      );
    } finally {
      this.virtualPhoneProvisioning.set(false);
    }
  }

  protected shareVirtualNumberInChat(): void {
    const phone = this.virtualPhone();
    if (!phone?.number) return;

    // Insert the virtual number into the message input
    const currentMessage = this.messageInput().trim();
    const numberMessage = `Here's my private number: ${phone.number}`;
    
    if (currentMessage) {
      this.messageInput.set(`${currentMessage}\n${numberMessage}`);
    } else {
      this.messageInput.set(numberMessage);
    }
    
    // Focus the input
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }
}
