import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  AfterViewInit,
  effect,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Datasource } from 'ngx-ui-scroll';
import { UiScrollModule } from 'ngx-ui-scroll';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { MatDialog } from '@angular/material/dialog';
import { ReportDialogComponent, ReportDialogData } from '../../components/report-dialog';
import { BlockConfirmDialogComponent, BlockConfirmDialogData } from '../../components/block-confirm-dialog';
import { MessageService, ConversationFilter, ReputationFilter } from '../../core/services/message.service';
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
export class MessagesComponent implements OnInit, OnDestroy, AfterViewInit {
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
  private readonly dialog = inject(MatDialog);

  @ViewChild(ChatInputComponent) chatInput!: ChatInputComponent;

  // Datasource state tracking
  private lastMessageCount = 0;
  private lastMessageId: string | undefined = undefined;
  private firstMessageId: string | undefined = undefined; // Track first message for prepend detection
  private isInitialLoad = true;
  private isReloading = false; // Prevent concurrent reloads
  private bofSubscription: Subscription | null = null; // Subscription for beginning-of-file detection

  protected readonly gallery = signal<GalleryState>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });
  protected readonly galleryCountdown = signal<number | null>(null);
  protected readonly currentDraft = signal<string>('');
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
  protected readonly reputationFilter = this.messageService.reputationFilter;
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

  // Pending messages (being sent) - shown separately from virtual scroll
  protected readonly pendingMessages = computed(() => {
    return this.messages().filter(m => m.pending);
  });

  // AI Assist panel state
  protected readonly isAiPanelOpen = this.aiChatService.isOpen;
  protected readonly hasAiAccess = this.aiChatService.hasAccess;

  // Messaging access - all users can message (Premium has unlimited, Free has reputation-based limits)
  protected readonly hasMessagingAccess = computed(() => {
    // All users can message - limits are enforced by reputation system for free users
    return true;
  });
  
  // Premium users have unlimited messaging without tier restrictions
  protected readonly hasUnlimitedMessaging = computed(() => {
    return this.subscriptionService.capabilities().unlimitedMessaging;
  });

  // Read receipts are a premium feature
  protected readonly showReadReceipts = computed(() => {
    return this.subscriptionService.capabilities().readReceipts;
  });

  // Message permission from reputation system
  protected readonly messagePermission = this.messageService.messagePermission;
  protected readonly messageBlocked = this.messageService.messageBlocked;
  protected readonly remainingMessages = this.messageService.remainingMessages;
  protected readonly isMessageLimitReached = this.messageService.isMessageLimitReached;

  // Virtual Phone state (Premium feature)
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
      userDraft: this.currentDraft(),
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
   * Only returns confirmed messages (not pending/optimistic ones)
   */
  protected messageDatasource = new Datasource<MessageDisplay>({
    get: (index: number, count: number, success: (items: MessageDisplay[]) => void) => {
      // Filter out pending messages - they're not part of the virtual scroll
      const confirmedMessages = this.messages().filter(m => !m.pending);
      const total = confirmedMessages.length;
      
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

      const items = confirmedMessages.slice(start, end);
      success(items);
    },
    settings: {
      bufferSize: 20,
      padding: 0.5,
      minIndex: 0,
      infinite: false,  // Don't reserve space for infinite scrolling - we have finite data
      inverse: true
    },
    devSettings: {
      debug: false,
      immediateLog: true
    }
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
      const isPremium = this.subscriptionService.isPremium();
      if (isPremium && !this.virtualPhone() && !this.virtualPhoneLoading() && !this.virtualPhoneLoadAttempted) {
        this.virtualPhoneLoadAttempted = true;
        this.loadVirtualPhone();
      }
    });

    // React to message changes and update the datasource
    // Uses reload() only for initial load, append() for new messages, updater for data changes
    effect(() => {
      const messages = this.messages();
      const adapter = this.messageDatasource.adapter;
      
      // Filter out pending messages for the datasource - they cause too many issues
      // We'll show them separately or let Firestore confirmation handle them
      const confirmedMessages = messages.filter(m => !m.pending);
      const confirmedCount = confirmedMessages.length;
      
      if (confirmedCount === 0) {
        this.lastMessageCount = 0;
        this.lastMessageId = undefined;
        this.firstMessageId = undefined;
        this.isInitialLoad = true;
        return;
      }

      const lastConfirmedId = confirmedMessages[confirmedCount - 1]?.id;
      const firstConfirmedId = confirmedMessages[0]?.id;
      const previousCount = this.lastMessageCount;
      const previousLastId = this.lastMessageId;
      const previousFirstId = this.firstMessageId;
      
      // Detect the type of change
      const countIncreased = confirmedCount > previousCount;
      const countDecreased = confirmedCount < previousCount;
      const lastIdChanged = lastConfirmedId !== previousLastId;
      const firstIdChanged = firstConfirmedId !== previousFirstId;
      
      // Prepend = first ID changed but last ID stayed the same (older messages loaded)
      const isPrepend = firstIdChanged && !lastIdChanged && countIncreased && previousCount > 0;
      // Append = last ID changed (new messages at the end)
      const isAppend = lastIdChanged && !firstIdChanged && countIncreased && previousCount > 0;
      // Deletion = count decreased (message removed from signal)
      const isDeletion = countDecreased && previousCount > 0;
      
      const structuralChange = countIncreased || countDecreased || lastIdChanged || firstIdChanged;
      
      // Capture whether this is initial load before updating state
      const wasInitialLoad = this.isInitialLoad;
      
      // Skip if already processing a structural change to prevent concurrent operations
      if (this.isReloading) {
        return;
      }
      
      // CASE 1: Initial load - use reload()
      if (wasInitialLoad) {
        // Update tracking state immediately for initial load
        this.isInitialLoad = false;
        this.lastMessageCount = confirmedCount;
        this.lastMessageId = lastConfirmedId;
        this.firstMessageId = firstConfirmedId;
        const doReload = async () => {
          if (this.isReloading) return;
          this.isReloading = true;
          
          try {
            // Wait for adapter to be ready
            if (!adapter.init) {
              await new Promise<void>(resolve => {
                const sub = adapter.init$.subscribe((ready) => {
                  if (ready) {
                    sub.unsubscribe();
                    resolve();
                  }
                });
              });
            }
            
            // Update maxIndex so scroller knows the boundaries
            adapter.fix({ maxIndex: confirmedCount - 1 });
            
            // Reload starting from the last message (bottom)
            const startIndex = Math.max(0, confirmedCount - 1);
            await adapter.reload(startIndex);
            
            // Wait for all fetch cycles to complete
            await adapter.relax();
            
            // Scroll to absolute bottom
            adapter.fix({ scrollPosition: +Infinity });
            
            // Give browser time to apply scroll, then verify
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Double-check scroll position after a short delay
            adapter.fix({ scrollPosition: +Infinity });
          } finally {
            this.isReloading = false;
          }
        };
        
        doReload();
      } 
      // CASE 2: Older messages prepended (infinite scroll up)
      else if (isPrepend && adapter.init) {
        const prependCount = confirmedCount - previousCount;
        
        // Update tracking state before async operation
        this.lastMessageCount = confirmedCount;
        this.firstMessageId = firstConfirmedId;
        this.isReloading = true;
        
        // Use reload to keep buffer indices in sync with signal indices
        // Reload at current position + prependCount to maintain scroll position
        const doReload = async () => {
          try {
            // Get current first visible index before reload
            const currentFirstVisibleIndex = adapter.firstVisible?.$index ?? 0;
            // After prepending, the same visual position is at currentIndex + prependCount
            const newFirstVisibleIndex = currentFirstVisibleIndex + prependCount;
                        
            // Update boundaries
            adapter.fix({ 
              minIndex: 0, 
              maxIndex: confirmedCount - 1 
            });
            
            // Reload at the adjusted index to maintain scroll position
            await adapter.reload(newFirstVisibleIndex);
            
            // Wait for render to complete
            await adapter.relax();
          } finally {
            this.isReloading = false;
          }
        };
        
        doReload();
      }
      // CASE 3: New messages added to the end - use append()
      else if (isAppend && adapter.init) {
        const appendCount = confirmedCount - previousCount;
        
        // Only use append for small additions (1-5 messages)
        if (appendCount > 0 && appendCount <= 5) {
          // Update tracking state before async operation
          this.lastMessageCount = confirmedCount;
          this.lastMessageId = lastConfirmedId;
          this.isReloading = true;
          
          const newMessages = confirmedMessages.slice(-appendCount);
          
          const doAppend = async () => {
            try {
              // Update maxIndex to include new messages
              adapter.fix({ maxIndex: confirmedCount - 1 });
              
              // Append new messages to the buffer with eof: true
              await adapter.append({ items: newMessages, eof: true });
              
              // Wait for render to complete
              await adapter.relax();
              
              // Scroll to bottom
              adapter.fix({ scrollPosition: +Infinity });
              await adapter.relax();
              await new Promise(resolve => setTimeout(resolve, 50));
              adapter.fix({ scrollPosition: +Infinity });
            } finally {
              this.isReloading = false;
            }
          };
          
          doAppend();
        } else {
          // Too many messages appended - use reload
          this.lastMessageCount = confirmedCount;
          this.lastMessageId = lastConfirmedId;
          this.firstMessageId = firstConfirmedId;
          this.isReloading = true;
          
          const doReload = async () => {
            try {
              adapter.fix({ maxIndex: confirmedCount - 1 });
              const startIndex = Math.max(0, confirmedCount - 1);
              await adapter.reload(startIndex);
              await adapter.relax();
              adapter.fix({ scrollPosition: +Infinity });
              await new Promise(resolve => setTimeout(resolve, 50));
              adapter.fix({ scrollPosition: +Infinity });
            } finally {
              this.isReloading = false;
            }
          };
          
          doReload();
        }
      }
      // CASE 4: Message deletion - reload at current position to maintain scroll
      else if (isDeletion && adapter.init) {
        this.lastMessageCount = confirmedCount;
        this.lastMessageId = lastConfirmedId;
        this.firstMessageId = firstConfirmedId;
        this.isReloading = true;
        
        const doReload = async () => {
          try {
            // Get current first visible index before reload
            const currentFirstVisibleIndex = adapter.firstVisible?.$index ?? 0;
            // Adjust index to stay in bounds after deletion
            const safeIndex = Math.min(currentFirstVisibleIndex, Math.max(0, confirmedCount - 1));
            
            adapter.fix({ minIndex: 0, maxIndex: confirmedCount - 1 });
            await adapter.reload(safeIndex);
            await adapter.relax();
          } finally {
            this.isReloading = false;
          }
        };
        
        doReload();
      }
      // CASE 5: Other structural changes (both first and last changed, or complex changes) - use reload
      else if (structuralChange && adapter.init) {
        this.lastMessageCount = confirmedCount;
        this.lastMessageId = lastConfirmedId;
        this.firstMessageId = firstConfirmedId;
        this.isReloading = true;
        
        const doReload = async () => {
          try {
            adapter.fix({ maxIndex: confirmedCount - 1 });
            const startIndex = Math.max(0, confirmedCount - 1);
            await adapter.reload(startIndex);
            await adapter.relax();
            adapter.fix({ scrollPosition: +Infinity });
            await new Promise(resolve => setTimeout(resolve, 50));
            adapter.fix({ scrollPosition: +Infinity });
          } finally {
            this.isReloading = false;
          }
        };
        
        doReload();
      }
      // CASE 6: Data-only changes (read status, timed image status, deletion status, etc.) - use updater
      else if (!structuralChange && adapter.init) {
        const messageMap = new Map(confirmedMessages.map(m => [m.id, m]));
        let hadUpdates = false;
        
        adapter.fix({
          updater: (item, update) => {
            const currentMessage = item.data as MessageDisplay;
            const freshMessage = messageMap.get(currentMessage.id);
            
            if (!freshMessage) return;
            
            // Check if any relevant properties changed
            const hasChanges = 
              currentMessage.recipientViewedAt !== freshMessage.recipientViewedAt ||
              currentMessage.isRecipientViewing !== freshMessage.isRecipientViewing ||
              currentMessage.recipientViewExpired !== freshMessage.recipientViewExpired ||
              currentMessage.read !== freshMessage.read ||
              currentMessage.imageViewedAt !== freshMessage.imageViewedAt ||
              currentMessage.isImageExpired !== freshMessage.isImageExpired ||
              currentMessage.isDeletedForAll !== freshMessage.isDeletedForAll ||
              currentMessage.isDeletedForMe !== freshMessage.isDeletedForMe ||
              currentMessage.content !== freshMessage.content ||
              currentMessage.type !== freshMessage.type;
            
            if (hasChanges) {
              // Replace item.data with fresh message to trigger OnPush change detection
              // (OnPush requires new object reference, not just property mutations)
              item.data = freshMessage;
              update();
              hadUpdates = true;
            }
          }
        });
        
        // Force change detection for visible items if any updates occurred
        if (hadUpdates) {
          adapter.check();
        }
      }
    });
  }

  ngOnInit(): void {
    this.conversationIdFromRoute = this.route.snapshot.paramMap.get('conversationId');
  }

  ngAfterViewInit(): void {
    // Subscribe to beginning-of-file detection for infinite scroll up
    this.setupInfiniteScrollUp();
  }

  ngOnDestroy(): void {
    this.messageService.closeConversation();
    this.stopSenderCountdowns();
    this.stopRecipientCountdowns();
    this.stopGalleryCountdown();
    this.bofSubscription?.unsubscribe();
  }

  /**
   * Set up infinite scroll for loading older messages when user scrolls to top
   */
  private setupInfiniteScrollUp(): void {
    const adapter = this.messageDatasource.adapter;
    
    // Wait for adapter to be ready, then subscribe to bof$
    const checkAdapter = () => {
      if (adapter.init) {
        this.bofSubscription = adapter.bof$.subscribe(async (bof) => {
          
          // When at beginning of buffer and more messages exist, load them
          if (bof && this.hasOlderMessages() && !this.loadingOlderMessages() && !this.isReloading) {
            await this.messageService.loadOlderMessages();
          }
        });
      } else {
        // Retry after a short delay if adapter not ready
        setTimeout(checkAdapter, 100);
      }
    };
    
    checkAdapter();
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
    this.lastMessageId = undefined;
    this.firstMessageId = undefined;
    this.isInitialLoad = true;
    this.isReloading = false;
    
    // Check if we're navigating from /messages (no conversation) to /messages/{id}
    // In this case, the component will be destroyed and recreated, so don't open here
    // The effect will handle opening after the new component mounts
    // Only call openConversation directly if we're switching between conversations
    // (i.e., already have a conversationIdFromRoute, meaning component won't recreate)
    if (this.conversationIdFromRoute) {
      // Already on /messages/{id}, switching to another - component stays, open directly
      this.messageService.openConversation(conversation);
    }
    
    this.router.navigate(['/messages', conversation.id], { replaceUrl: true });
  }

  protected onFilterChanged(filter: ConversationFilter): void {
    this.messageService.setConversationFilter(filter);
  }

  protected onReputationFilterChanged(tier: ReputationFilter): void {
    this.messageService.setReputationFilter(tier);
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

  protected onBlockUser(): void {
    const activeConvo = this.activeConversation();
    if (!activeConvo?.otherUser) return;

    const dialogRef = this.dialog.open<BlockConfirmDialogComponent, BlockConfirmDialogData, boolean>(
      BlockConfirmDialogComponent,
      {
        data: {
          userId: activeConvo.otherUser.uid,
          displayName: activeConvo.otherUser.displayName || 'This user',
        },
        width: '450px',
        maxWidth: '95vw',
      }
    );

    dialogRef.afterClosed().subscribe((blocked) => {
      if (blocked) {
        // User was blocked - close conversation and go back to messages list
        this.messageService.closeConversation();
        this.router.navigate(['/messages'], { replaceUrl: true });
      }
    });
  }

  protected onReportUser(): void {
    const activeConvo = this.activeConversation();
    if (!activeConvo?.otherUser) return;

    this.dialog.open<ReportDialogComponent, ReportDialogData>(ReportDialogComponent, {
      data: {
        userId: activeConvo.otherUser.uid,
        displayName: activeConvo.otherUser.displayName || 'This user',
        conversationId: activeConvo.id,
      },
      width: '500px',
      maxWidth: '95vw',
    });
  }

  // ============================================
  // MESSAGE HANDLERS
  // ============================================

  protected onMessageSent(event: SendMessageEvent): void {
    this.messageService.sendMessage(event.content, event.files, event.timer ?? undefined);
    this.currentDraft.set(''); // Clear draft after sending
  }

  protected onTyping(): void {
    this.messageService.setTyping(true);
  }

  protected onDraftChanged(draft: string): void {
    this.currentDraft.set(draft);
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

  protected onUpgradeClicked(): void {
    this.subscriptionService.showUpgradePrompt();
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
