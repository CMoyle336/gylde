import { Injectable, inject, signal, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { 
  Firestore, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  addDoc, 
  updateDoc,
  doc,
  serverTimestamp,
  Unsubscribe 
} from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Activity, ActivityDisplay } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class ActivityService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  private unsubscribe: Unsubscribe | null = null;
  private initialLoadDone = false;
  private knownActivityIds = new Set<string>();

  private readonly _activities = signal<ActivityDisplay[]>([]);
  private readonly _unreadCount = signal<number>(0);

  readonly activities = this._activities.asReadonly();
  readonly unreadCount = this._unreadCount.asReadonly();

  /**
   * Start listening to real-time activity updates
   */
  subscribeToActivities(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    const currentUser = this.authService.user();
    if (!currentUser) return;

    // Unsubscribe from previous subscription if any
    this.unsubscribeFromActivities();
    
    // Reset state for new subscription
    this.initialLoadDone = false;
    this.knownActivityIds.clear();

    // Subscribe to real-time updates for activities where current user is the recipient
    this.unsubscribe = this.firestoreService.subscribeToCollection<Activity>(
      `users/${currentUser.uid}/activities`,
      [this.firestoreService.orderByField('createdAt', 'desc'), this.firestoreService.limitTo(20)],
      (activities) => {
        const displayActivities = activities.map(a => this.mapToDisplay(a));
        const now = new Date();
        
        if (this.initialLoadDone) {
          // After initial load, show toast for any new activities we haven't seen
          activities.forEach(activity => {
            if (activity.id && !this.knownActivityIds.has(activity.id)) {
              this.showActivityToast(activity);
              this.knownActivityIds.add(activity.id);
            }
          });
        } else {
          // On initial load, show toast only for very recent activities (within 10 seconds)
          activities.forEach(activity => {
            const activityTime = activity.createdAt instanceof Date 
              ? activity.createdAt 
              : new Date((activity.createdAt as any)?.seconds * 1000 || 0);
            const isRecent = (now.getTime() - activityTime.getTime()) < 10000;
            
            if (activity.id) {
              this.knownActivityIds.add(activity.id);
              if (isRecent && !activity.read) {
                this.showActivityToast(activity);
              }
            }
          });
          this.initialLoadDone = true;
        }
        
        this._activities.set(displayActivities);
        this._unreadCount.set(activities.filter(a => !a.read).length);
      }
    );
  }

  /**
   * Stop listening to activity updates
   */
  unsubscribeFromActivities(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // Note: Activity creation is handled by Firebase Cloud Functions
  // The functions trigger on favorite/match document creation and create activities server-side

  /**
   * Mark an activity as read
   */
  async markAsRead(activityId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      await this.firestoreService.updateDocument(
        `users/${currentUser.uid}/activities`,
        activityId,
        { read: true }
      );
    } catch (error) {
      console.error('Failed to mark activity as read:', error);
    }
  }

  /**
   * Mark all activities as read
   */
  async markAllAsRead(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    const activities = this._activities();
    for (const activity of activities.filter(a => !a.read)) {
      await this.markAsRead(activity.id);
    }
  }

  /**
   * Record a profile view in the profileViews collection.
   * Activity creation is handled by a Firebase trigger (onProfileViewCreated).
   * Uses a single document per viewer-viewed pair for efficiency.
   */
  async recordProfileView(viewedUserId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser || currentUser.uid === viewedUserId) return;

    try {
      const viewsRef = collection(this.firestore, 'profileViews');
      
      // Check if we already have a view record from this user to this profile
      const existingViewQuery = query(
        viewsRef,
        where('viewerId', '==', currentUser.uid),
        where('viewedUserId', '==', viewedUserId),
        limit(1)
      );
      
      const existingSnapshot = await getDocs(existingViewQuery);
      
      if (!existingSnapshot.empty) {
        const existingDoc = existingSnapshot.docs[0];
        const lastViewTime = existingDoc.data()['viewedAt']?.toDate?.() || new Date(0);
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        // Always update the timestamp
        await updateDoc(existingDoc.ref, {
          viewedAt: serverTimestamp(),
          viewerName: currentUser.displayName || 'Someone',
          viewerPhoto: currentUser.photoURL,
        });
        
        // Only trigger activity update if last view was more than an hour ago
        // (The trigger won't fire on update, only on create, so we handle this differently)
        if (lastViewTime <= hourAgo) {
          // For views older than an hour, we need to update the activity too
          // This is handled by manually updating the activity
          await this.updateViewActivity(viewedUserId, currentUser);
        }
      } else {
        // Create new profile view record
        // Activity creation is handled by onProfileViewCreated trigger
        await addDoc(viewsRef, {
          viewerId: currentUser.uid,
          viewerName: currentUser.displayName || 'Someone',
          viewerPhoto: currentUser.photoURL,
          viewedUserId: viewedUserId,
          viewedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Error recording profile view:', error);
    }
  }

  /**
   * Update an existing view activity (for when we update an old profile view record)
   */
  private async updateViewActivity(
    viewedUserId: string,
    currentUser: { uid: string; displayName: string | null; photoURL: string | null }
  ): Promise<void> {
    try {
      const activitiesRef = collection(this.firestore, `users/${viewedUserId}/activities`);
      const activityQuery = query(
        activitiesRef,
        where('fromUserId', '==', currentUser.uid),
        where('type', '==', 'view'),
        limit(1)
      );
      
      const activitySnapshot = await getDocs(activityQuery);
      if (!activitySnapshot.empty) {
        await updateDoc(activitySnapshot.docs[0].ref, {
          createdAt: serverTimestamp(),
          read: false,
          link: `/user/${currentUser.uid}`,
          fromUserName: currentUser.displayName || 'Someone',
          fromUserPhoto: currentUser.photoURL,
        });
      }
    } catch (error) {
      console.error('Error updating view activity:', error);
    }
  }

  /**
   * Get when a specific user last viewed the current user's profile.
   * Returns null if they've never viewed or if an error occurs.
   */
  async getLastViewedBy(userId: string): Promise<Date | null> {
    const currentUser = this.authService.user();
    if (!currentUser || currentUser.uid === userId) return null;

    try {
      const viewsRef = collection(this.firestore, 'profileViews');
      // Using simple equality filters (no orderBy) to avoid index requirements
      const q = query(
        viewsRef,
        where('viewerId', '==', userId),
        where('viewedUserId', '==', currentUser.uid),
        limit(1)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;

      const data = snapshot.docs[0].data();
      const viewedAt = data['viewedAt'];
      
      if (!viewedAt) return null;
      
      // Handle Firestore Timestamp
      return viewedAt.toDate ? viewedAt.toDate() : new Date(viewedAt);
    } catch (error) {
      console.error('Error getting last viewed by:', error);
      return null;
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeFromActivities();
  }

  private showActivityToast(activity: Activity): void {
    const message = this.getActivityMessage(activity);
    
    this.snackBar.open(message, 'View', {
      duration: 5000,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['activity-toast', `activity-toast-${activity.type}`],
    });
  }

  private getActivityMessage(activity: Activity): string {
    switch (activity.type) {
      case 'favorite':
        return `⭐ ${activity.fromUserName} favorited you!`;
      case 'match':
        return `🎉 You matched with ${activity.fromUserName}!`;
      case 'message':
        return `💬 ${activity.fromUserName} sent you a message`;
      case 'view':
        return `👀 ${activity.fromUserName} viewed your profile`;
      case 'photo_access_request':
        return `🔒 ${activity.fromUserName} requested access to your private photos`;
      default:
        return `${activity.fromUserName} interacted with you`;
    }
  }

  private mapToDisplay(activity: Activity): ActivityDisplay {
    const createdAt = activity.createdAt instanceof Date 
      ? activity.createdAt 
      : new Date((activity.createdAt as any).seconds * 1000);

    return {
      id: activity.id || '',
      type: activity.type,
      fromUserId: activity.fromUserId,
      name: activity.fromUserName,
      photo: activity.fromUserPhoto,
      time: createdAt.toISOString(),
      timeAgo: this.getTimeAgo(createdAt),
      read: activity.read,
      link: activity.link,
    };
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }
}
