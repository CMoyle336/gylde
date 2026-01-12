/**
 * Service for managing private photo access
 */
import { Injectable, inject, signal, effect } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, query, where, onSnapshot, orderBy, doc, getDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { PhotoAccessRequest, PhotoAccessGrant, PhotoAccessSummary } from '../interfaces/photo.interface';

export interface PhotoAccessRequestDisplay extends PhotoAccessRequest {
  id: string;
}

export interface PhotoAccessGrantDisplay extends PhotoAccessGrant {
  id: string;
}

@Injectable({
  providedIn: 'root'
})
export class PhotoAccessService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  // Pending requests count (for badge)
  private readonly _pendingRequestsCount = signal(0);
  readonly pendingRequestsCount = this._pendingRequestsCount.asReadonly();

  // Pending requests list
  private readonly _pendingRequests = signal<PhotoAccessRequestDisplay[]>([]);
  readonly pendingRequests = this._pendingRequests.asReadonly();

  // Granted access list
  private readonly _grants = signal<PhotoAccessGrantDisplay[]>([]);
  readonly grants = this._grants.asReadonly();

  private requestsUnsubscribe?: () => void;
  private grantsUnsubscribe?: () => void;

  constructor() {
    // Subscribe to pending requests when user is authenticated
    effect(() => {
      const user = this.authService.user();
      if (user) {
        this.subscribeToRequests(user.uid);
        this.subscribeToGrants(user.uid);
      } else {
        this.cleanup();
      }
    });
  }

  private subscribeToRequests(userId: string): void {
    this.requestsUnsubscribe?.();

    const requestsRef = collection(this.firestore, `users/${userId}/photoAccessRequests`);
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
      })) as PhotoAccessRequestDisplay[];

      this._pendingRequests.set(requests);
      this._pendingRequestsCount.set(requests.length);
    });
  }

  private subscribeToGrants(userId: string): void {
    this.grantsUnsubscribe?.();

    const grantsRef = collection(this.firestore, `users/${userId}/photoAccessGrants`);
    const q = query(grantsRef, orderBy('grantedAt', 'desc'));

    this.grantsUnsubscribe = onSnapshot(q, (snapshot) => {
      const grants = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        grantedAt: doc.data()['grantedAt']?.toDate(),
      })) as PhotoAccessGrantDisplay[];

      this._grants.set(grants);
    });
  }

  private cleanup(): void {
    this.requestsUnsubscribe?.();
    this.grantsUnsubscribe?.();
    this._pendingRequests.set([]);
    this._pendingRequestsCount.set(0);
    this._grants.set([]);
  }

  /**
   * Request access to view a user's private photos
   */
  async requestAccess(targetUserId: string): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<{ targetUserId: string }, { success: boolean; message: string }>(
      this.functions,
      'requestPhotoAccess'
    );
    const result = await fn({ targetUserId });
    return result.data;
  }

  /**
   * Respond to a photo access request
   */
  async respondToRequest(
    requesterId: string,
    response: 'grant' | 'deny'
  ): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<
      { requesterId: string; response: 'grant' | 'deny' },
      { success: boolean; message: string }
    >(this.functions, 'respondToPhotoAccessRequest');
    const result = await fn({ requesterId, response });
    return result.data;
  }

  /**
   * Revoke previously granted photo access
   */
  async revokeAccess(userId: string): Promise<{ success: boolean; message: string }> {
    const fn = httpsCallable<{ userId: string }, { success: boolean; message: string }>(
      this.functions,
      'revokePhotoAccess'
    );
    const result = await fn({ userId });
    return result.data;
  }

  /**
   * Check if current user has access to view another user's private photos
   */
  async checkAccess(targetUserId: string): Promise<PhotoAccessSummary> {
    const fn = httpsCallable<
      { targetUserId: string },
      { hasAccess: boolean; isSelf?: boolean; requestStatus?: string; requestedAt?: Date }
    >(this.functions, 'checkPhotoAccess');
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
    const photos = userData['onboarding']?.photos || [];

    // Build photo list with privacy info
    const photoList = photos.map((url: string) => {
      const detail = photoDetails.find((d: { url: string }) => d.url === url);
      return {
        url,
        isPrivate: detail?.isPrivate || false,
      };
    });

    // Check access if not self
    if (isSelf) {
      return { photos: photoList, hasAccess: true };
    }

    const accessSummary = await this.checkAccess(targetUserId);
    return { photos: photoList, hasAccess: accessSummary.hasAccess };
  }
}
