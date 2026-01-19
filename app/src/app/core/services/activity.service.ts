import { Injectable, inject, signal, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
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
  writeBatch,
  serverTimestamp,
  Unsubscribe 
} from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { BlockService } from './block.service';
import { Activity, ActivityDisplay } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class ActivityService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly firestoreService = inject(FirestoreService);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly blockService = inject(BlockService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  private unsubscribe: Unsubscribe | null = null;
  private initialLoadDone = false;
  // Track activity ID -> last seen timestamp to detect both new and updated activities
  private knownActivityTimestamps = new Map<string, number>();
  
  // Toast debouncing - collect activities and show only the most recent after a delay
  private pendingToastActivities: Activity[] = [];
  private toastDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly TOAST_DEBOUNCE_MS = 500;
  
  // Debounce profile view recording to prevent duplicate requests
  private pendingProfileViewPromise: Promise<void> | null = null;
  private lastRecordedProfileView: { userId: string; timestamp: number } | null = null;

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
    this.knownActivityTimestamps.clear();

    // Subscribe to real-time updates for activities where current user is the recipient
    this.unsubscribe = this.firestoreService.subscribeToCollection<Activity>(
      `users/${currentUser.uid}/activities`,
      [this.firestoreService.orderByField('createdAt', 'desc'), this.firestoreService.limitTo(20)],
      (activities) => {
        const displayActivities = activities.map(a => this.mapToDisplay(a));
        const now = new Date();
        
        if (this.initialLoadDone) {
          // After initial load, queue toast for new OR updated activities
          activities.forEach(activity => {
            if (!activity.id) return;
            
            const activityTime = this.getActivityTimestamp(activity);
            const lastSeenTime = this.knownActivityTimestamps.get(activity.id) || 0;
            
            // Queue toast if this is a new activity OR if the timestamp has changed (updated)
            if (activityTime > lastSeenTime) {
              this.queueToast(activity);
              this.knownActivityTimestamps.set(activity.id, activityTime);
            }
          });
        } else {
          // On initial load, queue toast only for very recent activities (within 10 seconds)
          activities.forEach(activity => {
            if (!activity.id) return;
            
            const activityTime = this.getActivityTimestamp(activity);
            const isRecent = (now.getTime() - activityTime) < 10000;
            
            this.knownActivityTimestamps.set(activity.id, activityTime);
            if (isRecent && !activity.read) {
              this.queueToast(activity);
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
   * Get timestamp from activity as milliseconds
   */
  private getActivityTimestamp(activity: Activity): number {
    if (activity.createdAt instanceof Date) {
      return activity.createdAt.getTime();
    }
    return (activity.createdAt as any)?.seconds * 1000 || 0;
  }

  /**
   * Queue an activity for toast notification with debouncing.
   * If multiple activities come in quickly, only the most recent one will be shown.
   */
  private queueToast(activity: Activity): void {
    this.pendingToastActivities.push(activity);
    
    // Clear any existing timeout
    if (this.toastDebounceTimeout) {
      clearTimeout(this.toastDebounceTimeout);
    }
    
    // Set a new timeout to show the most recent toast
    this.toastDebounceTimeout = setTimeout(() => {
      this.showDebouncedToast();
    }, this.TOAST_DEBOUNCE_MS);
  }

  /**
   * Show the most recent activity from the pending queue
   */
  private showDebouncedToast(): void {
    if (this.pendingToastActivities.length === 0) return;
    
    // Find the activity with the most recent timestamp
    const mostRecent = this.pendingToastActivities.reduce((latest, current) => {
      const latestTime = this.getActivityTimestamp(latest);
      const currentTime = this.getActivityTimestamp(current);
      return currentTime > latestTime ? current : latest;
    });
    
    // Clear the queue
    this.pendingToastActivities = [];
    this.toastDebounceTimeout = null;
    
    // Show toast for the most recent activity
    this.showActivityToast(mostRecent);
  }

  /**
   * Stop listening to activity updates
   */
  unsubscribeFromActivities(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Clear any pending toast timeout
    if (this.toastDebounceTimeout) {
      clearTimeout(this.toastDebounceTimeout);
      this.toastDebounceTimeout = null;
    }
    this.pendingToastActivities = [];
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
   * Mark all activities as read using a batch write
   */
  async markAllAsRead(): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser) return;

    try {
      // Query for all unread activities
      const activitiesRef = collection(this.firestore, `users/${currentUser.uid}/activities`);
      const unreadQuery = query(activitiesRef, where('read', '==', false));
      const snapshot = await getDocs(unreadQuery);

      if (snapshot.empty) return;

      // Use batch write to update all at once
      const batch = writeBatch(this.firestore);
      snapshot.docs.forEach(docSnapshot => {
        batch.update(docSnapshot.ref, { read: true });
      });

      await batch.commit();
    } catch (error) {
      console.error('Failed to mark all activities as read:', error);
    }
  }

  /**
   * Record a profile view in the profileViews collection.
   * Activity creation is handled by a Firebase trigger (onProfileViewCreated).
   * Uses a single document per viewer-viewed pair for efficiency.
   * Respects the user's activity.createOnView setting.
   * Debounces to prevent duplicate requests within the same page load.
   */
  async recordProfileView(viewedUserId: string): Promise<void> {
    const currentUser = this.authService.user();
    if (!currentUser || currentUser.uid === viewedUserId) return;

    // Debounce: skip if we already recorded this view in the last 5 seconds
    const now = Date.now();
    if (this.lastRecordedProfileView?.userId === viewedUserId && 
        (now - this.lastRecordedProfileView.timestamp) < 5000) {
      return;
    }

    // If already recording this view, return the pending promise
    if (this.pendingProfileViewPromise) {
      return this.pendingProfileViewPromise;
    }

    this.pendingProfileViewPromise = this.doRecordProfileView(viewedUserId, currentUser)
      .finally(() => {
        this.pendingProfileViewPromise = null;
      });

    return this.pendingProfileViewPromise;
  }

  /**
   * Internal method to actually record the profile view
   */
  private async doRecordProfileView(
    viewedUserId: string,
    currentUser: { uid: string; displayName: string | null; photoURL: string | null }
  ): Promise<void> {
    try {
      const viewsRef = collection(this.firestore, 'profileViews');
      
      // Check settings and existing view in parallel
      const existingViewQuery = query(
        viewsRef,
        where('viewerId', '==', currentUser.uid),
        where('viewedUserId', '==', viewedUserId),
        limit(1)
      );
      
      const [profile, existingSnapshot] = await Promise.all([
        this.userProfileService.getCurrentUserProfile(),
        getDocs(existingViewQuery),
      ]);
      
      // Check if current user has profile view activity creation enabled
      const createOnView = profile?.settings?.activity?.createOnView;
      
      // If explicitly set to false, don't record the view
      if (createOnView === false) {
        return;
      }
      
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
        // Fire in background - don't block
        if (lastViewTime <= hourAgo) {
          this.updateViewActivity(viewedUserId, currentUser).catch(err => {
            console.error('Error updating view activity:', err);
          });
        }
      } else {
        // Create new profile view record
        await addDoc(viewsRef, {
          viewerId: currentUser.uid,
          viewerName: currentUser.displayName || 'Someone',
          viewerPhoto: currentUser.photoURL,
          viewedUserId: viewedUserId,
          viewedAt: serverTimestamp(),
        });
      }

      // Mark as recorded to prevent duplicate calls
      this.lastRecordedProfileView = { userId: viewedUserId, timestamp: Date.now() };
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
    // Don't show toast if the activity is from a blocked user
    if (activity.fromUserId && this.blockService.isUserBlocked(activity.fromUserId)) {
      return;
    }

    // For messages: don't show toast if user is already in that conversation
    if (activity.type === 'message' && activity.link && this.router.url.startsWith(activity.link)) {
      return;
    }

    const message = this.getActivityMessage(activity);
    
    // Only show "View" action if there's a link to navigate to
    const actionLabel = activity.link ? 'View' : undefined;
    
    const snackBarRef = this.snackBar.open(message, actionLabel, {
      duration: 5000,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['activity-toast', `activity-toast-${activity.type}`],
    });

    // Navigate to the link when user clicks the action button
    if (activity.link) {
      snackBarRef.onAction().subscribe(() => {
        this.router.navigateByUrl(activity.link!);
      });
    }
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
      case 'photo_access_granted':
        return `✅ ${activity.fromUserName} granted you access to their private photos`;
      case 'photo_access_denied':
        return `❌ ${activity.fromUserName} denied your photo access request`;
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
