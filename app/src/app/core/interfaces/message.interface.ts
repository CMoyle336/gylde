import { FieldValue } from '@angular/fire/firestore';

/**
 * A single message in a conversation
 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: Date | FieldValue;
  read: boolean;
  type: 'text' | 'image' | 'system';
  imageUrls?: string[]; // For image messages
  deletedFor?: string[]; // User IDs who deleted this message for themselves
  deletedForAll?: boolean; // Sender deleted for everyone
  deletedForAllAt?: Date | FieldValue; // When it was deleted for everyone
}

/**
 * A conversation between two users
 */
export interface Conversation {
  id: string;
  participants: string[]; // Array of user UIDs
  participantInfo: {
    [uid: string]: {
      displayName: string | null;
      photoURL: string | null;
    };
  };
  lastMessage: {
    content: string;
    senderId: string;
    createdAt: Date | FieldValue;
  } | null;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
  unreadCount: {
    [uid: string]: number;
  };
  typing?: {
    [uid: string]: boolean;
  };
}

/**
 * Display-ready conversation for the UI
 */
export interface ConversationDisplay {
  id: string;
  otherUser: {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
  };
  lastMessage: string | null;
  lastMessageTime: Date | null;
  unreadCount: number;
  isOnline?: boolean;
}

/**
 * Display-ready message for the UI
 */
export interface MessageDisplay {
  id: string;
  content: string;
  isOwn: boolean;
  createdAt: Date;
  read: boolean;
  type: 'text' | 'image' | 'system';
  imageUrls?: string[]; // For image messages
  isDeletedForAll?: boolean; // Show "message was deleted" placeholder
}
