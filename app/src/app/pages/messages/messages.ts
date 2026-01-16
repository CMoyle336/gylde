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
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Datasource } from 'ngx-ui-scroll';
import { UiScrollModule } from 'ngx-ui-scroll';
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

// Import sub-components
import {
  ConversationListComponent,
  ChatHeaderComponent,
  MessageBubbleComponent,
  ChatInputComponent,
  ImageGalleryComponent,
  VirtualPhoneSettingsComponent,
  GalleryState,
  GalleryOpenEvent,
  SendMessageEvent,
} from './components';

@Component({
  selector: 'app-messages',
  templateUrl: './messages.html',
  styleUrl: './messages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    UiScrollModule,
    AiAssistPanelComponent,
    ConversationListComponent,
    ChatHeaderComponent,
    MessageBubbleComponent,
    ChatInputComponent,
    ImageGalleryComponent,
    VirtualPhoneSettingsComponent,
  ],
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

  @ViewChild(ChatInputComponent) chatInput!: ChatInputComponent;

  // Datasource state tracking
  private lastMessageCount = 0;
  private lastMessageId: string | undefined = undefined;
  private isInitialLoad = true;

  protected readonly gallery = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });
  protected readonly galleryCountdown = signal<number | null>(null);
  protected readonly senderCountdowns = signal<Map<string, number>>(new Map());
  protected readonly recipientCountdowns = signal<Map<string, number>>(new Map());
  private galleryCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private senderCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private recipientCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private conversationIdFromRoute: string | null = null;

  // Expose service signals
  protected readonly conversations = this.messageService.filteredConversations;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly messages = this.messageService.messages;
  protected readonly loading = this.messageService.loading;
  protected readonly isOtherUserTyping = this.messageService.isOtherUserTyping;
  protected readonly conversationFilter = this.messageService.conversationFilter;
  protected readonly otherUserStatus = this.messageService.otherUserStatus;
  protected readonly totalUnreadCount = this.messageService.totalUnreadCount;
  protected readonly archivedCount = this.messageService.archivedCount;
  protected readonly loadingOlderMessages = this.messageService.loadingOlderMessages;
  protected readonly hasOlderMessages = this.messageService.hasOlderMessages;
  
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
  protected readonly showVirtualPhoneSettings = signal(false);

  protected readonly hasVerifiedPhone = computed(() => {
    const profile = this.userProfileService.profile();
    return profile?.phoneNumberVerified === true && !!profile?.phoneNumber;
  });

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
      userDraft: '',
      isEmptyThread: this.messages().length === 0,
    };
  });

  private virtualPhoneLoadAttempted = false;

  // ============================================
  // NGX-UI-SCROLL DATASOURCE
  // ============================================

  /**
   * Datasource for ngx-ui-scroll
   * Uses standard indices: 0 = oldest, N-1 = newest
   * startIndex is set dynamically when messages load
   */
  protected messageDatasource = new Datasource<MessageDisplay>({
    get: (index: number, count: number, success: (items: MessageDisplay[]) => void) => {
      const allMessages = this.messages();
      const total = allMessages.length;
      
      if (total === 0) {
        success([]);
        return;
      }

      const start = Math.max(0, index);
      const end = Math.min(total, index + count);
      
      if (start >= end) {
        success([]);
        return;
      }

      const items = allMessages.slice(start, end);
      success(items);
    },
    settings: {
      bufferSize: 20,
      padding: 0.5,
      minIndex: 0,
    },
  });

  constructor() {
    effect(() => {
      const convos = this.conversations();
      if (this.conversationIdFromRoute && convos.length > 0 && !this.activeConversation()) {
        const targetConvo = convos.find(c => c.id === this.conversationIdFromRoute);
        if (targetConvo) {
          this.messageService.openConversation(targetConvo);
        }
      }
    });

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

    effect(() => {
      const isElite = this.subscriptionService.isElite();
      if (isElite && !this.virtualPhone() && !this.virtualPhoneLoading() && !this.virtualPhoneLoadAttempted) {
        this.virtualPhoneLoadAttempted = true;
        this.loadVirtualPhone();
      }
    });

    // React to message changes and update the datasource
    effect(() => {
      const messages = this.messages();
      const messageCount = messages.length;
      const adapter = this.messageDatasource.adapter;
      
      const lastMessageId = messages[messageCount - 1]?.id;

      if (messageCount === 0) {
        this.lastMessageCount = 0;
        this.lastMessageId = undefined;
        this.isInitialLoad = true;
        return;
      }

      const hasNewMessages = messageCount > this.lastMessageCount || 
        (messageCount === this.lastMessageCount && lastMessageId !== this.lastMessageId);
      const hadMessages = this.lastMessageCount > 0;
      
      // If this is the first load or conversation change, reload the datasource
      if (this.isInitialLoad) {
        this.isInitialLoad = false;
        this.lastMessageCount = messageCount;
        this.lastMessageId = lastMessageId;
        
        const reloadIndex = Math.max(0, messageCount - 1);
        
        const doReload = () => {
          adapter.reload(reloadIndex);
          
          // Wait for loading to complete, then scroll to bottom
          const loadingSub = adapter.isLoading$.subscribe((isLoading) => {
            if (!isLoading && adapter.itemsCount > 0) {
              loadingSub.unsubscribe();
              adapter.fix({
                scrollPosition: +Infinity
              });
            }
          });
        };
        
        if (adapter.init) {
          doReload();
        } else {
          const sub = adapter.init$.subscribe((ready) => {
            if (ready) {
              sub.unsubscribe();
              doReload();
            }
          });
        }
      } else if (hasNewMessages && hadMessages) {
        // New message added - append to the end (bottom)
        // If count increased, slice from lastMessageCount
        // If count is same but lastMessageId changed, get messages after the old lastMessageId
        let newMessages: MessageDisplay[];
        
        if (messageCount > this.lastMessageCount) {
          // Count increased - simple slice
          newMessages = messages.slice(this.lastMessageCount);
        } else {
          // Count same but lastMessageId changed - find new messages by ID
          const oldLastIndex = messages.findIndex(m => m.id === this.lastMessageId);
          if (oldLastIndex === -1) {
            // Old message not found - just get the last message
            newMessages = [messages[messageCount - 1]];
          } else {
            // Get everything after the old last message
            newMessages = messages.slice(oldLastIndex + 1);
          }
        }
        
        this.lastMessageCount = messageCount;
        this.lastMessageId = lastMessageId;
        
        if (adapter.init && newMessages.length > 0) {
          adapter.append({
            items: newMessages,
            eof: true,
          });
          
          // Wait for append to complete, then scroll to bottom
          adapter.relax(() => {
            adapter.fix({
              scrollPosition: +Infinity
            });
          });
        }
      } else {
        // Existing messages may have been updated (read status, viewed, etc.)
        // Refresh the visible items to reflect changes
        this.lastMessageCount = messageCount;
        this.lastMessageId = lastMessageId;
        
        if (adapter.init) {
          adapter.check();
        }
      }
    });
  }

  ngOnInit(): void {
    this.conversationIdFromRoute = this.route.snapshot.paramMap.get('conversationId');
  }

  ngOnDestroy(): void {
    this.messageService.closeConversation();
    this.stopSenderCountdowns();
    this.stopRecipientCountdowns();
    this.stopGalleryCountdown();
  }

  // ============================================
  // COUNTDOWN MANAGEMENT
  // ============================================

  private startSenderCountdowns(messages: MessageDisplay[]): void {
    this.updateSenderCountdowns(messages);
    
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

  private stopSenderCountdowns(): void {
    if (this.senderCountdownInterval) {
      clearInterval(this.senderCountdownInterval);
      this.senderCountdownInterval = null;
    }
    this.senderCountdowns.set(new Map());
  }

  protected getSenderCountdown(messageId: string): number | null {
    return this.senderCountdowns().get(messageId) ?? null;
  }

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

  private stopRecipientCountdowns(): void {
    if (this.recipientCountdownInterval) {
      clearInterval(this.recipientCountdownInterval);
      this.recipientCountdownInterval = null;
    }
    this.recipientCountdowns.set(new Map());
  }

  protected getRecipientCountdown(messageId: string): number | null {
    return this.recipientCountdowns().get(messageId) ?? null;
  }

  // ============================================
  // CONVERSATION LIST HANDLERS
  // ============================================

  protected onConversationSelected(conversation: ConversationDisplay): void {
    // Reset state for new conversation
    this.lastMessageCount = 0;
    this.isInitialLoad = true;
    
    this.messageService.openConversation(conversation);
    this.router.navigate(['/messages', conversation.id], { replaceUrl: true });
  }

  protected onFilterChanged(filter: ConversationFilter): void {
    this.messageService.setConversationFilter(filter);
  }

  // ============================================
  // CHAT HEADER HANDLERS
  // ============================================

  protected onBackClicked(): void {
    this.messageService.closeConversation();
    this.router.navigate(['/messages'], { replaceUrl: true });
  }

  protected onViewProfile(): void {
    const activeConvo = this.activeConversation();
    if (!activeConvo?.otherUser?.uid) return;
    this.router.navigate(['/user', activeConvo.otherUser.uid]);
  }

  protected async onArchiveChat(): Promise<void> {
    const activeConvo = this.activeConversation();
    if (!activeConvo) return;
    
    await this.messageService.archiveConversation(activeConvo.id);
    this.onBackClicked();
  }

  protected async onUnarchiveChat(): Promise<void> {
    const activeConvo = this.activeConversation();
    if (!activeConvo) return;
    
    await this.messageService.unarchiveConversation(activeConvo.id);
  }

  protected onShareNumber(): void {
    const phone = this.virtualPhone();
    if (!phone?.number) return;

    const numberMessage = `Here's my private number: ${phone.number}`;
    this.chatInput?.setMessageInput(numberMessage);
  }

  // ============================================
  // MESSAGE HANDLERS
  // ============================================

  protected onMessageSent(event: SendMessageEvent): void {
    this.messageService.sendMessage(event.content, event.files, event.timer ?? undefined);
  }

  protected onTyping(): void {
    this.messageService.setTyping(true);
  }

  protected async onDeleteForMe(message: MessageDisplay): Promise<void> {
    await this.messageService.deleteMessageForMe(message.id);
  }

  protected async onDeleteForEveryone(message: MessageDisplay): Promise<void> {
    if (!message.isOwn) return;
    await this.messageService.deleteMessageForEveryone(message.id);
  }

  // ============================================
  // GALLERY HANDLERS
  // ============================================

  protected async onOpenGallery(event: GalleryOpenEvent): Promise<void> {
    const { images, startIndex, message } = event;

    if (message.imageTimer && message.isImageExpired && !message.isOwn) {
      return;
    }

    this.gallery.set({
      isOpen: true,
      images,
      currentIndex: startIndex,
      messageId: message.id,
      isTimed: !!message.imageTimer && !message.isOwn,
      isExpired: false,
    });

    if (message.imageTimer && !message.imageViewedAt && !message.isOwn) {
      await this.messageService.markImageAsViewed(message.id);
      this.startGalleryCountdown(message.imageTimer);
    } else if (message.imageTimer && message.imageViewedAt && !message.isOwn) {
      const elapsed = (Date.now() - message.imageViewedAt.getTime()) / 1000;
      const remaining = Math.max(0, message.imageTimer - elapsed);
      if (remaining > 0) {
        this.startGalleryCountdown(remaining);
      } else {
        this.gallery.update(g => ({ ...g, isExpired: true }));
      }
    }
  }

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

  private stopGalleryCountdown(): void {
    if (this.galleryCountdownInterval) {
      clearInterval(this.galleryCountdownInterval);
      this.galleryCountdownInterval = null;
    }
    this.galleryCountdown.set(null);
  }

  protected onGalleryClosed(): void {
    this.stopGalleryCountdown();
    this.gallery.update(g => ({ ...g, isOpen: false }));
  }

  protected onGalleryNavigated(index: number): void {
    this.gallery.update(g => ({ ...g, currentIndex: index }));
  }

  // ============================================
  // AI ASSIST HANDLERS
  // ============================================

  protected onAiAssistToggled(): void {
    this.aiChatService.toggle();
  }

  protected onAiInsertText(text: string): void {
    this.chatInput?.setMessageInput(text);
  }

  protected onAiPanelClosed(): void {
    this.chatInput?.focusInput();
  }

  // ============================================
  // VIRTUAL PHONE
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

  protected onVirtualPhoneCopy(): void {
    // Copy is handled internally by VirtualPhoneCardComponent
  }

  protected onVirtualPhoneSettings(): void {
    this.virtualPhoneError.set(null);
    this.showVirtualPhoneSettings.set(true);
  }

  protected async onVirtualPhoneProvision(): Promise<void> {
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

  protected onVirtualPhoneUpgrade(): void {
    this.subscriptionService.canPerformAction('hasVirtualPhone', true);
  }

  protected onVirtualPhoneSettingsClosed(): void {
    this.showVirtualPhoneSettings.set(false);
    this.virtualPhoneError.set(null);
  }

  protected async onVirtualPhoneSettingChanged(event: { key: keyof VirtualPhoneSettings; value: boolean }): Promise<void> {
    const user = this.auth.currentUser;
    const phone = this.virtualPhone();
    if (!user || !phone) return;

    const updatedSettings: VirtualPhoneSettings = {
      ...phone.settings,
      [event.key]: event.value,
    };
    this.virtualPhone.set({ ...phone, settings: updatedSettings });

    try {
      const privateDataRef = doc(this.firestore, 'users', user.uid, 'private', 'virtualPhone');
      await updateDoc(privateDataRef, {
        [`settings.${event.key}`]: event.value,
      });
    } catch (error) {
      console.error('Failed to update virtual phone setting:', error);
      this.virtualPhone.set(phone);
    }
  }

  protected async onVirtualPhoneReleased(): Promise<void> {
    this.virtualPhoneProvisioning.set(true);
    this.virtualPhoneError.set(null);

    try {
      const releaseFn = httpsCallable(this.functions, 'releaseVirtualNumber');
      await releaseFn();
      this.virtualPhone.set(null);
      this.onVirtualPhoneSettingsClosed();
    } catch (error: any) {
      console.error('Failed to release virtual number:', error);
      this.virtualPhoneError.set(
        error?.message || 'Failed to release number. Please try again.'
      );
    } finally {
      this.virtualPhoneProvisioning.set(false);
    }
  }
}
