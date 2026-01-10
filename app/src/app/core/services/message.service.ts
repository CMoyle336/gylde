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
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';
import {
  Message,
  Conversation,
  ConversationDisplay,
  MessageDisplay,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly firestore = inject(Firestore);
  private readonly storageService = inject(StorageService);
  private readonly authService = inject(AuthService);

  private readonly _conversations = signal<ConversationDisplay[]>([]);
  private readonly _activeConversation = signal<ConversationDisplay | null>(null);
  private readonly _messages = signal<MessageDisplay[]>([]);
  private readonly _loading = signal(false);
  private readonly _sending = signal(false);
  private readonly _isOtherUserTyping = signal(false);

  private conversationsUnsubscribe: Unsubscribe | null = null;
  private messagesUnsubscribe: Unsubscribe | null = null;
  private typingUnsubscribe: Unsubscribe | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTypingUpdate = 0;

  readonly conversations = this._conversations.asReadonly();
  readonly activeConversation = this._activeConversation.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly sending = this._sending.asReadonly();
  readonly isOtherUserTyping = this._isOtherUserTyping.asReadonly();

  readonly totalUnreadCount = computed(() => {
    return this._conversations().reduce((sum, conv) => sum + conv.unreadCount, 0);
  });

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
        const conversations: ConversationDisplay[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Conversation;
          const otherUserId = data.participants.find((id) => id !== currentUser.uid) || '';
          const otherUserInfo = data.participantInfo[otherUserId] || {
            displayName: 'Unknown User',
            photoURL: null,
          };

          return {
            id: doc.id,
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
    this.subscribeToMessages(conversation.id);
    this.subscribeToTypingStatus(conversation.id);
    this.markConversationAsRead(conversation.id);
  }

  /**
   * Close the active conversation
   */
  closeConversation(): void {
    // Clear our typing status before closing
    this.clearTypingStatus();
    this.unsubscribeFromTyping();
    this._activeConversation.set(null);
    this._messages.set([]);
    this._isOtherUserTyping.set(false);
    this.unsubscribeFromMessages();
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
        
        for (const docSnapshot of snapshot.docs) {
          const data = docSnapshot.data() as Message;
          
          // Skip messages deleted for this user (but not deletedForAll)
          if (data.deletedFor?.includes(currentUser.uid) && !data.deletedForAll) {
            continue;
          }

          // Calculate timed image status for current user (as recipient)
          let imageViewedAt: Date | null = null;
          let isImageExpired = false;
          
          if (data.imageTimer && data.imageViewedBy?.[currentUser.uid]) {
            imageViewedAt = this.toDate(data.imageViewedBy[currentUser.uid]);
            const expiresAt = new Date(imageViewedAt.getTime() + data.imageTimer * 1000);
            isImageExpired = new Date() > expiresAt;
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
              const expiresAt = new Date(recipientViewedAt.getTime() + data.imageTimer * 1000);
              const now = new Date();
              isRecipientViewing = now <= expiresAt;
              recipientViewExpired = now > expiresAt;
            }
          }

          messages.push({
            id: docSnapshot.id,
            content: data.deletedForAll ? '' : data.content,
            isOwn: data.senderId === currentUser.uid,
            createdAt: this.toDate(data.createdAt),
            read: data.read,
            type: data.deletedForAll ? 'system' : data.type,
            imageUrls: data.deletedForAll ? undefined : data.imageUrls,
            isDeletedForAll: data.deletedForAll,
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
      const conversationRef = doc(this.firestore, 'conversations', conversationId);
      await updateDoc(conversationRef, {
        [`unreadCount.${currentUser.uid}`]: 0,
      });
    } catch (error) {
      console.error('Error marking conversation as read:', error);
    }
  }

  /**
   * Helper to convert Firestore timestamp to Date
   */
  private toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value) {
      return (value as { toDate: () => Date }).toDate();
    }
    return new Date();
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
   * Clean up all subscriptions
   */
  cleanup(): void {
    this.unsubscribeFromConversations();
    this.unsubscribeFromMessages();
    this.unsubscribeFromTyping();
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }
}
