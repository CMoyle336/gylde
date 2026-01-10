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
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
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
        const messages: MessageDisplay[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Message;
          return {
            id: doc.id,
            content: data.content,
            isOwn: data.senderId === currentUser.uid,
            createdAt: this.toDate(data.createdAt),
            read: data.read,
            type: data.type,
          };
        });

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
   */
  async sendMessage(content: string): Promise<void> {
    const currentUser = this.authService.user();
    const activeConversation = this._activeConversation();

    if (!currentUser || !activeConversation || !content.trim()) return;

    this._sending.set(true);

    // Clear typing status when sending
    this.clearTypingStatus();

    try {
      const messagesRef = collection(
        this.firestore,
        'conversations',
        activeConversation.id,
        'messages'
      );

      // Add the message
      await addDoc(messagesRef, {
        conversationId: activeConversation.id,
        senderId: currentUser.uid,
        content: content.trim(),
        createdAt: serverTimestamp(),
        read: false,
        type: 'text',
      });

      // Update conversation's last message and unread count
      const conversationRef = doc(
        this.firestore,
        'conversations',
        activeConversation.id
      );

      await updateDoc(conversationRef, {
        lastMessage: {
          content: content.trim(),
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
