import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Unsubscribe,
  limit,
  getDocs,
  writeBatch,
  arrayUnion,
  deleteField,
  getDoc,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';
import { BlockService } from './block.service';
import {
  Message,
  Conversation,
  ConversationDisplay,
  MessageDisplay,
} from '../interfaces';
import { UserProfile } from '../interfaces/user.interface';

export type ConversationFilter = 'all' | 'unread' | 'archived';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly firestore = inject(Firestore);
  private readonly storageService = inject(StorageService);
  private readonly authService = inject(AuthService);
  private readonly blockService = inject(BlockService);

  private readonly _conversations = signal<ConversationDisplay[]>([]);
  private readonly _activeConversation = signal<ConversationDisplay | null>(null);
  private readonly _messages = signal<MessageDisplay[]>([]);
  private readonly _loading = signal(false);
  private readonly _sending = signal(false);
  private readonly _isOtherUserTyping = signal(false);
  private readonly _conversationFilter = signal<ConversationFilter>('all');
  private readonly _otherUserStatus = signal<{ isOnline: boolean; lastActiveAt: Date | null } | null>(null);

  private conversationsUnsubscribe: Unsubscribe | null = null;
  private messagesUnsubscribe: Unsubscribe | null = null;
  private typingUnsubscribe: Unsubscribe | null = null;
  private userStatusUnsubscribe: Unsubscribe | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTypingUpdate = 0;

  readonly conversations = this._conversations.asReadonly();
  readonly activeConversation = this._activeConversation.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly sending = this._sending.asReadonly();
  readonly isOtherUserTyping = this._isOtherUserTyping.asReadonly();
  readonly conversationFilter = this._conversationFilter.asReadonly();
  readonly otherUserStatus = this._otherUserStatus.asReadonly();

  // Filtered conversations based on current filter and block status
  readonly filteredConversations = computed(() => {
    const convos = this._conversations();
    const filter = this._conversationFilter();
    const blockedUserIds = this.blockService.blockedUserIds();
    
    // First filter by archive/unread status
    let filtered: ConversationDisplay[];
    switch (filter) {
      case 'unread':
        filtered = convos.filter(c => c.unreadCount > 0 && !c.isArchived);
        break;
      case 'archived':
        filtered = convos.filter(c => c.isArchived);
        break;
      default: // 'all'
        filtered = convos.filter(c => !c.isArchived);
    }
    
    // Then filter out blocked users (but keep the conversation visible so they can access chat history)
    // We mark blocked conversations differently rather than hiding them completely
    return filtered.map(c => ({
      ...c,
      isBlocked: c.otherUser?.uid ? blockedUserIds.has(c.otherUser.uid) : false,
    }));
  });

  // Count of archived conversations for badge
  readonly archivedCount = computed(() => {
    return this._conversations().filter(c => c.isArchived).length;
  });

  readonly totalUnreadCount = computed(() => {
    const activeId = this._activeConversation()?.id;
    return this._conversations().reduce((sum, conv) => {
      // Exclude active conversation from unread count since user is viewing it
      if (conv.id === activeId) return sum;
      return sum + conv.unreadCount;
    }, 0);
  });

  /**
   * Set the conversation filter
   */
  setConversationFilter(filter: ConversationFilter): void {
    this._conversationFilter.set(filter);
  }

  /**
   * Subscribe to real-time conversation updates for the current user
   */
  subscribeToConversations(): void {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    this._loading.set(true);

    const conversationsRef = collection(this.firestore, 'conversations');
    const q = query(
      conversationsRef,
      where('participants', 'array-contains', currentUser.uid),
      orderBy('updatedAt', 'desc')
    );


    this.conversationsUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const conversations: ConversationDisplay[] = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as Conversation;
          
          const otherUserId = data.participants.find((id) => id !== currentUser.uid) || '';
          const otherUserInfo = data.participantInfo[otherUserId] || {
            displayName: 'Unknown User',
            photoURL: null,
          };

          return {
            id: docSnapshot.id,
            otherUser: {
              uid: otherUserId,
              displayName: otherUserInfo.displayName,
              photoURL: otherUserInfo.photoURL,
            },
            lastMessage: data.lastMessage?.content || null,
            lastMessageTime: data.lastMessage?.createdAt
              ? this.toDate(data.lastMessage.createdAt)
              : null,
            unreadCount: data.unreadCount?.[currentUser.uid] || 0,
            isArchived: data.archivedBy?.includes(currentUser.uid) || false,
          };
        });

        this._conversations.set(conversations);
        this._loading.set(false);
      },
      (error) => {
        console.error('Error subscribing to conversations:', error);
        this._loading.set(false);
      }
    );
  }

  /**
   * Unsubscribe from conversation updates
   */
  unsubscribeFromConversations(): void {
    if (this.conversationsUnsubscribe) {
      this.conversationsUnsubscribe();
      this.conversationsUnsubscribe = null;
    }
  }

  /**
   * Open a conversation and subscribe to its messages
   */
  openConversation(conversation: ConversationDisplay): void {
    this._activeConversation.set(conversation);
    this._messages.set([]);
    this._isOtherUserTyping.set(false);
    this._otherUserStatus.set(null);
    this.subscribeToMessages(conversation.id);
    this.subscribeToTypingStatus(conversation.id);
    
    // Subscribe to other user's online status
    if (conversation.otherUser?.uid) {
      this.subscribeToUserStatus(conversation.otherUser.uid);
    }
    
    this.markConversationAsRead(conversation.id);
  }

  /**
   * Close the active conversation
   */
  closeConversation(): void {
    // Clear our typing status before closing
    this.clearTypingStatus();
    this.unsubscribeFromTyping();
    this.unsubscribeFromUserStatus();
    this._activeConversation.set(null);
    this._messages.set([]);
    this._isOtherUserTyping.set(false);
    this._otherUserStatus.set(null);
    this.unsubscribeFromMessages();
  }

  /**
   * Subscribe to a user's online status
   */
  private subscribeToUserStatus(userId: string): void {
    this.unsubscribeFromUserStatus();

    const userRef = doc(this.firestore, 'users', userId);
    
    this.userStatusUnsubscribe = onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) {
        this._otherUserStatus.set(null);
        return;
      }

      const userData = snapshot.data() as UserProfile;
      const privacy = userData.settings?.privacy;
      
      // Respect privacy settings
      const showOnlineStatus = privacy?.showOnlineStatus !== false;
      const showLastActive = privacy?.showLastActive !== false;
      
      let isOnline = false;
      let lastActiveAt: Date | null = null;
      
      if (showOnlineStatus && userData.lastActiveAt) {
        const lastActive = this.toDate(userData.lastActiveAt);
        if (lastActive) {
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          isOnline = lastActive.getTime() > fiveMinutesAgo.getTime();
          
          if (showLastActive) {
            lastActiveAt = lastActive;
          }
        }
      } else if (showLastActive && userData.lastActiveAt) {
        lastActiveAt = this.toDate(userData.lastActiveAt);
      }
      
      this._otherUserStatus.set({ isOnline, lastActiveAt });
    });
  }

  /**
   * Unsubscribe from user status updates
   */
  private unsubscribeFromUserStatus(): void {
    if (this.userStatusUnsubscribe) {
      this.userStatusUnsubscribe();
      this.userStatusUnsubscribe = null;
    }
  }

  /**
   * Subscribe to typing status for a conversation
   */
  private subscribeToTypingStatus(conversationId: string): void {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    this.unsubscribeFromTyping();

    const conversationRef = doc(this.firestore, 'conversations', conversationId);
    
    this.typingUnsubscribe = onSnapshot(conversationRef, (snapshot) => {
      const data = snapshot.data() as Conversation | undefined;
      if (!data?.typing) {
        this._isOtherUserTyping.set(false);
        return;
      }

      // Find if any other participant is typing
      const otherUserTyping = Object.entries(data.typing).some(
        ([uid, isTyping]) => uid !== currentUser.uid && isTyping
      );
      
      this._isOtherUserTyping.set(otherUserTyping);
    });
  }

  /**
   * Unsubscribe from typing status
   */
  private unsubscribeFromTyping(): void {
    if (this.typingUnsubscribe) {
      this.typingUnsubscribe();
      this.typingUnsubscribe = null;
    }
  }

  /**
   * Set current user's typing status
   * Debounced to prevent excessive writes
   */
  async setTyping(isTyping: boolean): Promise<void> {
    const currentUser = this.authService.user();
    const activeConvo = this._activeConversation();
    if (!currentUser || !activeConvo) return;

    const now = Date.now();
    
    // Debounce: only update if 2 seconds have passed since last update
    if (isTyping && now - this.lastTypingUpdate < 2000) {
      // Reset the auto-clear timeout
      if (this.typingTimeout) {
        clearTimeout(this.typingTimeout);
      }
      this.typingTimeout = setTimeout(() => this.clearTypingStatus(), 3000);
      return;
    }

    this.lastTypingUpdate = now;

    try {
      const conversationRef = doc(this.firestore, 'conversations', activeConvo.id);
      await updateDoc(conversationRef, {
        [`typing.${currentUser.uid}`]: isTyping,
      });

      // Auto-clear typing status after 3 seconds of no input
      if (isTyping) {
        if (this.typingTimeout) {
          clearTimeout(this.typingTimeout);
        }
        this.typingTimeout = setTimeout(() => this.clearTypingStatus(), 3000);
      }
    } catch (error) {
      console.error('Error setting typing status:', error);
    }
  }

  /**
   * Clear the current user's typing status
   */
  private async clearTypingStatus(): Promise<void> {
    const currentUser = this.authService.user();
    const activeConvo = this._activeConversation();
    if (!currentUser || !activeConvo) return;

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }

    try {
      const conversationRef = doc(this.firestore, 'conversations', activeConvo.id);
      await updateDoc(conversationRef, {
        [`typing.${currentUser.uid}`]: false,
      });
    } catch (error) {
      console.error('Error clearing typing status:', error);
    }
  }

  /**
   * Subscribe to messages in a conversation
   */
  private subscribeToMessages(conversationId: string): void {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    this.unsubscribeFromMessages();

    const messagesRef = collection(
      this.firestore,
      'conversations',
      conversationId,
      'messages'
    );
    const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(100));

    this.messagesUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messages: MessageDisplay[] = [];
        const activeConvo = this._activeConversation();
        
        for (const docSnapshot of snapshot.docs) {
          const data = docSnapshot.data() as Message;
          
          // Skip messages deleted for this user (but not deletedForAll)
          if (data.deletedFor?.includes(currentUser.uid) && !data.deletedForAll) {
            continue;
          }

          // Get sender info from conversation
          let senderName: string | null = null;
          let senderPhoto: string | null = null;
          
          if (data.senderId === currentUser.uid) {
            // It's the current user
            senderName = currentUser.displayName;
            senderPhoto = currentUser.photoURL;
          } else if (activeConvo) {
            senderName = activeConvo.otherUser?.displayName || 'Unknown';
            senderPhoto = activeConvo.otherUser?.photoURL || null;
          }

          // Calculate timed image status for current user (as recipient)
          let imageViewedAt: Date | null = null;
          let isImageExpired = false;
          
          if (data.imageTimer && data.imageViewedBy?.[currentUser.uid]) {
            imageViewedAt = this.toDate(data.imageViewedBy[currentUser.uid]);
            if (imageViewedAt) {
              const expiresAt = new Date(imageViewedAt.getTime() + data.imageTimer * 1000);
              isImageExpired = new Date() > expiresAt;
            }
          }

          // Calculate recipient viewing status for sender
          let recipientViewedAt: Date | null = null;
          let isRecipientViewing = false;
          let recipientViewExpired = false;
          
          if (data.imageTimer && data.senderId === currentUser.uid) {
            // Find the recipient's view timestamp (anyone who isn't the sender)
            const recipientUid = Object.keys(data.imageViewedBy || {}).find(uid => uid !== currentUser.uid);
            if (recipientUid && data.imageViewedBy?.[recipientUid]) {
              recipientViewedAt = this.toDate(data.imageViewedBy[recipientUid]);
              if (recipientViewedAt) {
                const expiresAt = new Date(recipientViewedAt.getTime() + data.imageTimer * 1000);
                const now = new Date();
                isRecipientViewing = now <= expiresAt;
                recipientViewExpired = now > expiresAt;
              }
            }
          }

          messages.push({
            id: docSnapshot.id,
            content: data.deletedForAll ? '' : data.content,
            isOwn: data.senderId === currentUser.uid,
            createdAt: this.toDate(data.createdAt) || new Date(),
            read: data.read,
            type: data.deletedForAll ? 'system' : data.type,
            imageUrls: data.deletedForAll ? undefined : data.imageUrls,
            isDeletedForAll: data.deletedForAll,
            senderId: data.senderId,
            senderName,
            senderPhoto,
            imageTimer: data.imageTimer,
            imageViewedAt,
            isImageExpired,
            recipientViewedAt,
            isRecipientViewing,
            recipientViewExpired,
          });
        }

        this._messages.set(messages);

        // Mark new messages as read if conversation is open
        if (this._activeConversation()?.id === conversationId) {
          this.markConversationAsRead(conversationId);
        }
      },
      (error) => {
        console.error('Error subscribing to messages:', error);
      }
    );
  }

  /**
   * Unsubscribe from message updates
   */
  private unsubscribeFromMessages(): void {
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = null;
    }
  }

  /**
   * Send a message in the active conversation
   * Supports text only, images only, or both text and images
   * @param content Text content
   * @param files Image files to upload
   * @param imageTimer Optional duration in seconds for timed images
   */
  async sendMessage(content: string, files: File[] = [], imageTimer?: number): Promise<void> {
    const currentUser = this.authService.user();
    const activeConversation = this._activeConversation();
    const hasText = content.trim().length > 0;
    const hasImages = files.length > 0;

    if (!currentUser || !activeConversation || (!hasText && !hasImages)) return;

    // Check if recipient's account is disabled
    const otherUserId = activeConversation.otherUser?.uid;
    if (otherUserId) {
      const recipientDisabled = await this.isUserDisabled(otherUserId);
      if (recipientDisabled) {
        console.warn('Cannot send message: recipient account is disabled');
        return;
      }
    }

    this._sending.set(true);

    // Clear typing status when sending
    this.clearTypingStatus();

    try {
      // Upload images if any
      let imageUrls: string[] = [];
      if (hasImages) {
        const uploadPromises = files.map((file, index) => {
          const path = `conversations/${activeConversation.id}/images/${Date.now()}_${index}_${file.name}`;
          return this.storageService.uploadFile(path, file);
        });
        imageUrls = await Promise.all(uploadPromises);
      }

      const messagesRef = collection(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages'
      );

      // Determine message type and content
      const messageType = hasImages ? 'image' : 'text';
      const messageContent = hasText ? content.trim() : 
        (files.length === 1 ? 'Sent an image' : `Sent ${files.length} images`);

      // Build message data
      const messageData: Record<string, unknown> = {
        conversationId: activeConversation.id,
        senderId: currentUser.uid,
        content: messageContent,
        createdAt: serverTimestamp(),
        read: false,
        type: messageType,
      };

      if (hasImages) {
        messageData['imageUrls'] = imageUrls;
        if (imageTimer && imageTimer > 0) {
          messageData['imageTimer'] = imageTimer;
        }
      }

      await addDoc(messagesRef, messageData);

      // Determine preview for conversation list
      let lastMessagePreview = messageContent;
      if (hasImages && !hasText) {
        lastMessagePreview = files.length === 1 ? '📷 Image' : `📷 ${files.length} images`;
      } else if (hasImages && hasText) {
        lastMessagePreview = `📷 ${messageContent}`;
      }

      // Update conversation's last message and unread count
      const conversationRef = doc(
        this.firestore,
        'conversations',
        activeConversation.id
      );

      await updateDoc(conversationRef, {
        lastMessage: {
          content: lastMessagePreview,
          senderId: currentUser.uid,
          createdAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
        [`unreadCount.${activeConversation.otherUser.uid}`]:
          (this._conversations().find((c) => c.id === activeConversation.id)
            ?.unreadCount || 0) + 1,
      });
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      this._sending.set(false);
    }
  }

  /**
   * Delete a message for the current user only
   */
  async deleteMessageForMe(messageId: string): Promise<void> {
    const currentUser = this.authService.user();
    const activeConversation = this._activeConversation();
    
    if (!currentUser || !activeConversation) return;

    try {
      const messageRef = doc(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages',
        messageId
      );

      await updateDoc(messageRef, {
        deletedFor: arrayUnion(currentUser.uid),
      });
    } catch (error) {
      console.error('Error deleting message for me:', error);
      throw error;
    }
  }

  /**
   * Delete a message for everyone (sender only)
   */
  async deleteMessageForEveryone(messageId: string): Promise<void> {
    const currentUser = this.authService.user();
    const activeConversation = this._activeConversation();
    
    if (!currentUser || !activeConversation) return;

    // Find the message to verify sender
    const message = this._messages().find(m => m.id === messageId);
    if (!message?.isOwn) {
      throw new Error('Can only delete your own messages for everyone');
    }

    try {
      const messageRef = doc(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages',
        messageId
      );

      // Get the current message data for archiving
      const messagesRef = collection(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages'
      );
      const messageSnapshot = await getDocs(
        query(messagesRef, where('__name__', '==', messageId), limit(1))
      );
      
      if (!messageSnapshot.empty) {
        const originalData = messageSnapshot.docs[0].data();
        
        // Archive the original content to admin-only collection
        const archiveRef = collection(this.firestore, 'deletedMessages');
        await addDoc(archiveRef, {
          originalMessageId: messageId,
          conversationId: activeConversation.id,
          senderId: currentUser.uid,
          content: originalData['content'] || '',
          imageUrls: originalData['imageUrls'] || [],
          originalCreatedAt: originalData['createdAt'],
          deletedAt: serverTimestamp(),
          deletedBy: currentUser.uid,
        });
      }

      // Clear the content from the original message
      await updateDoc(messageRef, {
        deletedForAll: true,
        deletedForAllAt: serverTimestamp(),
        content: '', // Clear the text content
        imageUrls: deleteField(), // Remove image URLs entirely
      });
    } catch (error) {
      console.error('Error deleting message for everyone:', error);
      throw error;
    }
  }

  /**
   * Mark a timed image as viewed by the current user
   * This starts the countdown timer for that user
   */
  async markImageAsViewed(messageId: string): Promise<void> {
    const currentUser = this.authService.user();
    const activeConversation = this._activeConversation();
    
    if (!currentUser || !activeConversation) return;

    try {
      const messageRef = doc(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages',
        messageId
      );

      // Use dot notation to update nested field
      await updateDoc(messageRef, {
        [`imageViewedBy.${currentUser.uid}`]: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error marking image as viewed:', error);
      throw error;
    }
  }

  /**
   * Start or get an existing conversation with another user
   */
  async startConversation(
    otherUserId: string,
    otherUserInfo: { displayName: string | null; photoURL: string | null }
  ): Promise<string> {
    const currentUser = this.authService.user();
    if (!currentUser) throw new Error('Not authenticated');

    // Check if conversation already exists
    const conversationsRef = collection(this.firestore, 'conversations');
    const q = query(
      conversationsRef,
      where('participants', 'array-contains', currentUser.uid)
    );

    const snapshot = await getDocs(q);
    const existingConv = snapshot.docs.find((doc) => {
      const data = doc.data() as Conversation;
      return data.participants.includes(otherUserId);
    });

    if (existingConv) {
      return existingConv.id;
    }

    // Create new conversation
    const newConversation: Omit<Conversation, 'id'> = {
      participants: [currentUser.uid, otherUserId],
      participantInfo: {
        [currentUser.uid]: {
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
        },
        [otherUserId]: otherUserInfo,
      },
      lastMessage: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadCount: {
        [currentUser.uid]: 0,
        [otherUserId]: 0,
      },
    };

    const docRef = await addDoc(conversationsRef, newConversation);
    return docRef.id;
  }

  /**
   * Mark all messages in a conversation as read
   */
  private async markConversationAsRead(conversationId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      // Update conversation unread count
      const conversationRef = doc(this.firestore, 'conversations', conversationId);
      await updateDoc(conversationRef, {
        [`unreadCount.${currentUser.uid}`]: 0,
      });

      // Mark unread messages from other users as read
      const messagesRef = collection(this.firestore, 'conversations', conversationId, 'messages');
      const unreadQuery = query(
        messagesRef,
        where('read', '==', false),
        where('senderId', '!=', currentUser.uid)
      );
      
      const snapshot = await getDocs(unreadQuery);
      const updatePromises = snapshot.docs.map(docSnapshot => 
        updateDoc(docSnapshot.ref, { read: true })
      );
      
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error marking conversation as read:', error);
    }
  }

  /**
   * Helper to convert Firestore timestamp to Date
   * Returns null if the value cannot be converted
   */
  private toDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value) {
      return (value as { toDate: () => Date }).toDate();
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) return date;
    }
    return null;
  }

  /**
   * Find an existing conversation with a user by their ID
   * Returns the conversation ID if found, null otherwise
   */
  async findConversationByUserId(otherUserId: string): Promise<string | null> {
    const currentUser = this.authService.user();
    if (!currentUser) return null;

    const conversationsRef = collection(this.firestore, 'conversations');
    const q = query(
      conversationsRef,
      where('participants', 'array-contains', currentUser.uid)
    );

    const snapshot = await getDocs(q);
    const existingConv = snapshot.docs.find((doc) => {
      const data = doc.data() as Conversation;
      return data.participants.includes(otherUserId);
    });

    return existingConv?.id ?? null;
  }

  /**
   * Archive a conversation for the current user
   */
  async archiveConversation(conversationId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const conversationRef = doc(this.firestore, 'conversations', conversationId);
      await updateDoc(conversationRef, {
        archivedBy: arrayUnion(currentUser.uid),
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      throw error;
    }
  }

  /**
   * Unarchive a conversation for the current user
   */
  async unarchiveConversation(conversationId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      const conversationRef = doc(this.firestore, 'conversations', conversationId);
      // Need to get current archivedBy array and remove user
      const snapshot = await getDoc(conversationRef);
      if (snapshot.exists()) {
        const data = snapshot.data() as Conversation;
        const updatedArchivedBy = (data.archivedBy || []).filter(uid => uid !== currentUser.uid);
        await updateDoc(conversationRef, {
          archivedBy: updatedArchivedBy,
        });
      }
    } catch (error) {
      console.error('Error unarchiving conversation:', error);
      throw error;
    }
  }

  /**
   * Format last active time for display
   */
  formatLastActive(date: Date | null): string {
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  /**
   * Check if a user's account is disabled
   */
  private async isUserDisabled(userId: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return true; // Treat non-existent as disabled
      const userData = userSnap.data() as { settings?: { account?: { disabled?: boolean } } };
      return userData?.settings?.account?.disabled === true;
    } catch (error) {
      console.error('Error checking user disabled status:', error);
      return false; // Allow messaging on error to avoid blocking
    }
  }

  /**
   * Clean up all subscriptions
   */
  cleanup(): void {
    this.unsubscribeFromConversations();
    this.unsubscribeFromMessages();
    this.unsubscribeFromTyping();
    this.unsubscribeFromUserStatus();
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }
}
