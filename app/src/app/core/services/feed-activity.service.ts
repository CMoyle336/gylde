/**
 * Service for managing feed activities (likes, comments on posts)
 * Separate from profile activities (favorites, matches, views, messages)
 */
import { Injectable, inject, signal, OnDestroy, PLATFORM_ID, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { 
  Firestore, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  doc,
  updateDoc,
  writeBatch,
  Unsubscribe 
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { FeedActivity, FeedActivityDisplay } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class FeedActivityService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  private unsubscribe: Unsubscribe | null = null;

  private readonly _feedActivities = signal<FeedActivityDisplay[]>([]);
  private readonly _unreadCount = signal<number>(0);
  private readonly _loading = signal<boolean>(false);

  readonly feedActivities = this._feedActivities.asReadonly();
  readonly unreadCount = this._unreadCount.asReadonly();
  readonly loading = this._loading.asReadonly();

  constructor() {
    // Auto-subscribe when user is authenticated
    effect(() => {
      const user = this.authService.user();
      if (user) {
        this.subscribeToFeedActivities();
      } else {
        this.unsubscribeFromFeedActivities();
        this._feedActivities.set([]);
        this._unreadCount.set(0);
      }
    });
  }

  /**
   * Start listening to real-time feed activity updates
   */
  subscribeToFeedActivities(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    const currentUser = this.authService.user();
    if (!currentUser) return;

    // Unsubscribe from previous subscription if any
    this.unsubscribeFromFeedActivities();
    this._loading.set(true);

    const feedActivitiesRef = collection(
      this.firestore, 
      `users/${currentUser.uid}/feedActivities`
    );
    
    const q = query(
      feedActivitiesRef,
      orderBy('lastInteractionAt', 'desc'),
      limit(20)
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      const activities = snapshot.docs.map(doc => {
        const data = doc.data() as FeedActivity;
        return this.mapToDisplay(data);
      });
      
      this._feedActivities.set(activities);
      this._unreadCount.set(activities.filter(a => !a.read).length);
      this._loading.set(false);
    }, (error) => {
      console.error('Error subscribing to feed activities:', error);
      this._loading.set(false);
    });
  }

  /**
   * Stop listening to feed activity updates
   */
  unsubscribeFromFeedActivities(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Map a FeedActivity to display format
   */
  private mapToDisplay(activity: FeedActivity): FeedActivityDisplay {
    const lastInteractionAt = activity.lastInteractionAt;
    let date: Date;
    
    if (lastInteractionAt && typeof lastInteractionAt === 'object' && 'toDate' in lastInteractionAt) {
      date = (lastInteractionAt as { toDate: () => Date }).toDate();
    } else if (lastInteractionAt instanceof Date) {
      date = lastInteractionAt;
    } else {
      date = new Date();
    }

    return {
      id: activity.id,
      postId: activity.postId,
      fromUserId: activity.fromUserId,
      fromUserName: activity.fromUserName,
      fromUserPhoto: activity.fromUserPhoto,
      liked: activity.liked,
      commented: activity.commented,
      commentCount: activity.commentCount,
      timeAgo: this.getTimeAgo(date),
      read: activity.read,
      commentId: activity.commentId,
      isCommentLike: activity.isCommentLike,
    };
  }

  /**
   * Calculate relative time string
   */
  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    return date.toLocaleDateString();
  }

  /**
   * Mark a single feed activity as read
   */
  async markAsRead(activityId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    const activityRef = doc(
      this.firestore,
      `users/${currentUser.uid}/feedActivities/${activityId}`
    );

    try {
      await updateDoc(activityRef, { read: true });
    } catch (error) {
      console.error('Error marking feed activity as read:', error);
    }
  }

  /**
   * Mark all feed activities as read
   */
  async markAllAsRead(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    const unreadActivities = this._feedActivities().filter(a => !a.read);
    if (unreadActivities.length === 0) return;

    const batch = writeBatch(this.firestore);

    for (const activity of unreadActivities) {
      const activityRef = doc(
        this.firestore,
        `users/${currentUser.uid}/feedActivities/${activity.id}`
      );
      batch.update(activityRef, { read: true });
    }

    try {
      await batch.commit();
    } catch (error) {
      console.error('Error marking all feed activities as read:', error);
    }
  }

  /**
   * Get a formatted message for the activity
   */
  getActivityMessage(activity: FeedActivityDisplay): string {
    const name = activity.fromUserName;
    
    // Handle comment likes separately
    if (activity.isCommentLike) {
      return `${name} liked your comment`;
    }
    
    if (activity.liked && activity.commented) {
      return `${name} liked and commented on your post`;
    } else if (activity.liked) {
      return `${name} liked your post`;
    } else if (activity.commented) {
      if (activity.commentCount > 1) {
        return `${name} commented ${activity.commentCount} times on your post`;
      }
      return `${name} commented on your post`;
    }
    
    return `${name} interacted with your post`;
  }

  ngOnDestroy(): void {
    this.unsubscribeFromFeedActivities();
  }
}
