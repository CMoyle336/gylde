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
  type: 'text' | 'image' | 'system';
  imageUrls?: string[]; // For image messages
  deletedFor?: string[]; // User IDs who deleted this message for themselves
  deletedForAll?: boolean; // Sender deleted for everyone
  deletedForAllAt?: Date | FieldValue; // When it was deleted for everyone
  // Temporary/timed image fields
  imageTimer?: number; // Duration in seconds the recipient can view the image
  imageViewedBy?: { // Track when each user viewed the timed image
    [uid: string]: Date | FieldValue;
  };
}

/**
 * A conversation between two users
 */
export interface Conversation {
  id: string;
  participants: string[]; // Array of user UIDs (always 2 for 1:1)
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
  // Last time each user viewed this conversation
  // Messages created before this timestamp are considered "read" for that user
  lastViewedAt?: {
    [uid: string]: Date | FieldValue;
  };
  typing?: {
    [uid: string]: boolean;
  };
  archivedBy?: string[]; // User IDs who have archived this conversation
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
  isArchived: boolean;
  isBlocked?: boolean;
  // Last time the other user viewed this conversation (for read receipts)
  otherUserLastViewedAt?: Date | null;
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
  isDeletedForMe?: boolean; // Show "You deleted this message" placeholder
  // Sender info for displaying avatar/name in chat
  senderId: string;
  senderName: string | null;
  senderPhoto: string | null;
  // Temporary/timed image fields
  imageTimer?: number; // Duration in seconds
  imageViewedAt?: Date | null; // When current user first viewed (null if not yet)
  isImageExpired?: boolean; // True if the user has already viewed and timer expired
  // For sender: track when recipient viewed
  recipientViewedAt?: Date | null; // When recipient first opened the image
  isRecipientViewing?: boolean; // True if recipient is currently viewing (timer not expired)
  recipientViewExpired?: boolean; // True if recipient's timer has expired
  // Optimistic UI state
  pending?: boolean; // True if message is being sent (not yet confirmed by server)
}
