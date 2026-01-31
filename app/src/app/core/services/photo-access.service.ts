/**
 * Service for managing private content access (photos and posts)
 */
import { Injectable, inject, signal, effect } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, query, where, onSnapshot, orderBy, doc, getDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { PrivateAccessRequest, PrivateAccessGrant, PrivateAccessSummary } from '../interfaces/photo.interface';

export interface PrivateAccessRequestDisplay extends PrivateAccessRequest {
  id: string;
}

export interface PrivateAccessGrantDisplay extends PrivateAccessGrant {
  id: string;
}

export interface PrivateAccessReceivedDisplay {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerPhoto: string | null;
  grantedAt: Date;
}

// Legacy aliases for backward compatibility
/** @deprecated Use PrivateAccessRequestDisplay instead */
export type PhotoAccessRequestDisplay = PrivateAccessRequestDisplay;
/** @deprecated Use PrivateAccessGrantDisplay instead */
export type PhotoAccessGrantDisplay = PrivateAccessGrantDisplay;

@Injectable({
  providedIn: 'root'
})
export class PrivateAccessService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  // Pending requests count (for badge)
  private readonly _pendingRequestsCount = signal(0);
  readonly pendingRequestsCount = this._pendingRequestsCount.asReadonly();

  // Pending requests list
  private readonly _pendingRequests = signal<PrivateAccessRequestDisplay[]>([]);
  readonly pendingRequests = this._pendingRequests.asReadonly();

  // Granted access list (users you've granted access to)
  private readonly _grants = signal<PrivateAccessGrantDisplay[]>([]);
  readonly grants = this._grants.asReadonly();

  // Received access list (users who've granted access to you)
  private readonly _receivedAccess = signal<PrivateAccessReceivedDisplay[]>([]);
  readonly receivedAccess = this._receivedAccess.asReadonly();

  private requestsUnsubscribe?: () => void;
  private grantsUnsubscribe?: () => void;
  private receivedUnsubscribe?: () => void;

  constructor() {
    // Subscribe to pending requests when user is authenticated
    effect(() => {
      const user = this.authService.user();
      if (user) {
        this.subscribeToRequests(user.uid);
        this.subscribeToGrants(user.uid);
        this.subscribeToReceivedAccess(user.uid);
      } else {
        this.cleanup();
      }
    });
  }

  private subscribeToRequests(userId: string): void {
    this.requestsUnsubscribe?.();

    const requestsRef = collection(this.firestore, `users/${userId}/privateAccessRequests`);
    const q = query(
      requestsRef,
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc')
    );

    this.requestsUnsubscribe = onSnapshot(q, (snapshot) => {
      const requests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        requestedAt: doc.data()['requestedAt']?.toDate(),
      })) as PrivateAccessRequestDisplay[];

      this._pendingRequests.set(requests);
      this._pendingRequestsCount.set(requests.length);
    });
  }

  private subscribeToGrants(userId: string): void {
    this.grantsUnsubscribe?.();

    const grantsRef = collection(this.firestore, `users/${userId}/privateAccessGrants`);
    const q = query(grantsRef, orderBy('grantedAt', 'desc'));

    this.grantsUnsubscribe = onSnapshot(q, (snapshot) => {
      const grants = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        grantedAt: doc.data()['grantedAt']?.toDate(),
      })) as PrivateAccessGrantDisplay[];

      this._grants.set(grants);
    });
  }

  private subscribeToReceivedAccess(userId: string): void {
    this.receivedUnsubscribe?.();

    const receivedRef = collection(this.firestore, `users/${userId}/privateAccessReceived`);
    const q = query(receivedRef, orderBy('grantedAt', 'desc'));

    this.receivedUnsubscribe = onSnapshot(q, (snapshot) => {
      const received = snapshot.docs.map(doc => ({
        id: doc.id,
        ownerId: doc.data()['ownerId'] as string,
        ownerName: doc.data()['ownerName'] as string,
        ownerPhoto: doc.data()['ownerPhoto'] as string | null,
        grantedAt: doc.data()['grantedAt']?.toDate(),
      })) as PrivateAccessReceivedDisplay[];

      this._receivedAccess.set(received);
    });
  }

  private cleanup(): void {
    this.requestsUnsubscribe?.();
    this.grantsUnsubscribe?.();
    this.receivedUnsubscribe?.();
    this._pendingRequests.set([]);
    this._pendingRequestsCount.set(0);
    this._grants.set([]);
    this._receivedAccess.set([]);
  }

  /**
   * Request access to view a user's private content (photos and posts)
   */
  async requestAccess(targetUserId: string): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<{ targetUserId: string }, { success: boolean; message: string }>(
      this.functions,
      'requestPrivateAccess'
    );
    const result = await fn({ targetUserId });
    return result.data;
  }

  /**
   * Cancel a pending private content access request
   */
  async cancelRequest(targetUserId: string): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<{ targetUserId: string }, { success: boolean; message: string }>(
      this.functions,
      'cancelPrivateAccessRequest'
    );
    const result = await fn({ targetUserId });
    return result.data;
  }

  /**
   * Respond to a private content access request
   */
  async respondToRequest(
    requesterId: string,
    response: 'grant' | 'deny'
  ): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<
      { requesterId: string; response: 'grant' | 'deny' },
      { success: boolean; message: string }
    >(this.functions, 'respondToPrivateAccessRequest');
    const result = await fn({ requesterId, response });
    return result.data;
  }

  /**
   * Revoke previously granted private content access
   */
  async revokeAccess(userId: string): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<{ userId: string }, { success: boolean; message: string }>(
      this.functions,
      'revokePrivateAccess'
    );
    const result = await fn({ userId });
    return result.data;
  }

  /**
   * Check if current user has access to view another user's private content
   */
  async checkAccess(targetUserId: string): Promise<PrivateAccessSummary> {
    const fn = httpsCallable<
      { targetUserId: string },
      { hasAccess: boolean; isSelf?: boolean; requestStatus?: string; requestedAt?: Date }
    >(this.functions, 'checkPrivateAccess');
    const result = await fn({ targetUserId });
    return {
      hasAccess: result.data.hasAccess,
      requestStatus: result.data.requestStatus as 'pending' | 'granted' | 'denied' | undefined,
      requestedAt: result.data.requestedAt,
    };
  }

  /**
   * Toggle a photo's private status
   */
  async togglePhotoPrivacy(
    photoUrl: string,
    isPrivate: boolean
  ): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<
      { photoUrl: string; isPrivate: boolean },
      { success: boolean; message: string }
    >(this.functions, 'togglePhotoPrivacy');
    const result = await fn({ photoUrl, isPrivate });
    return result.data;
  }

  /**
   * Get photo details with privacy info for a specific user
   * Returns which photos are private and whether current user has access
   */
  async getPhotoDetailsForUser(
    targetUserId: string
  ): Promise<{ photos: { url: string; isPrivate: boolean }[]; hasAccess: boolean }> {
    const currentUser = this.authService.user();
    const isSelf = currentUser?.uid === targetUserId;

    // Get target user's profile
    const userDoc = await getDoc(doc(this.firestore, 'users', targetUserId));
    if (!userDoc.exists()) {
      return { photos: [], hasAccess: false };
    }

    const userData = userDoc.data();
    const photoDetails = userData['onboarding']?.photoDetails || [];

    // Build photo list with privacy info from photoDetails (sorted by order)
    const photoList = [...photoDetails]
      .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
      .map((detail: { url: string; isPrivate?: boolean }) => ({
        url: detail.url,
        isPrivate: detail.isPrivate || false,
      }));

    // Check access if not self
    if (isSelf) {
      return { photos: photoList, hasAccess: true };
    }

    const accessSummary = await this.checkAccess(targetUserId);
    return { photos: photoList, hasAccess: accessSummary.hasAccess };
  }

  /**
   * Subscribe to real-time private content access status updates for a specific user
   * Used on the user profile page to detect when access is granted/denied
   * @returns Unsubscribe function
   */
  subscribeToAccessStatus(
    targetUserId: string,
    callback: (status: PrivateAccessSummary) => void
  ): () => void {
    const currentUser = this.authService.user();
    if (!currentUser) {
      callback({ hasAccess: false });
      return () => {};
    }

    // Self always has access
    if (currentUser.uid === targetUserId) {
      callback({ hasAccess: true });
      return () => {};
    }

    // Listen to the request document for status changes
    const requestDocRef = doc(
      this.firestore,
      `users/${targetUserId}/privateAccessRequests/${currentUser.uid}`
    );

    const unsubscribe = onSnapshot(requestDocRef, (snapshot) => {
      if (!snapshot.exists()) {
        // No request exists
        callback({ hasAccess: false, requestStatus: undefined });
        return;
      }

      const data = snapshot.data();
      const status = data['status'] as 'pending' | 'granted' | 'denied';
      
      callback({
        hasAccess: status === 'granted',
        requestStatus: status,
        requestedAt: data['requestedAt']?.toDate(),
      });
    });

    return unsubscribe;
  }

  /**
   * Backfill privateAccess collection for existing grants
   * This syncs privateAccessGrants to privateAccess for the feed system
   */
  async backfillPrivateAccess(): Promise<{ success: boolean; message: string; count: number }> {
    const fn = httpsCallable<void, { success: boolean; message: string; count: number }>(
      this.functions,
      'backfillPrivateAccess'
    );
    const result = await fn();
    return result.data;
  }
}

// Legacy alias for backward compatibility
/** @deprecated Use PrivateAccessService instead */
export { PrivateAccessService as PhotoAccessService };
