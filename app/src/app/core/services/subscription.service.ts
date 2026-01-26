import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { RemoteConfigService } from './remote-config.service';
import { AnalyticsService } from './analytics.service';
import {
  SubscriptionTier,
  UserSubscription,
  SubscriptionCapabilities,
  getSubscriptionCapabilities,
  SUBSCRIPTION_PRICE,
  TrustData,
  ReputationData,
} from '../interfaces';

/**
 * Private user data structure (stored in users/{uid}/private/data)
 */
interface PrivateUserData {
  profileProgress: number;
  trust?: TrustData;
  reputation?: ReputationData;
  subscription: UserSubscription;
  isFounder?: boolean;
  founderCity?: string;
  updatedAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private readonly authService = inject(AuthService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly remoteConfigService = inject(RemoteConfigService);
  private readonly analytics = inject(AnalyticsService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  // Current subscription state - loaded from private subcollection
  private readonly _subscription = signal<UserSubscription | null>(null);
  private readonly _profileProgress = signal<number>(0);
  private readonly _trustData = signal<TrustData | null>(null);
  private readonly _reputationData = signal<ReputationData | null>(null);
  private readonly _isFounder = signal<boolean>(false);
  private readonly _founderCity = signal<string | null>(null);
  private readonly _loading = signal(false);
  private unsubscribe: (() => void) | null = null;
  
  // Track previous tier to detect changes
  private previousTier: SubscriptionTier | null = null;

  // Public signals
  readonly subscription = this._subscription.asReadonly();
  readonly profileProgress = this._profileProgress.asReadonly();
  readonly trustData = this._trustData.asReadonly();
  readonly reputationData = this._reputationData.asReadonly();
  readonly isFounder = this._isFounder.asReadonly();
  readonly founderCity = this._founderCity.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly currentTier = computed<SubscriptionTier>(() => {
    const sub = this._subscription();
    return sub?.tier === 'premium' ? 'premium' : 'free';
  });

  readonly capabilities = computed<SubscriptionCapabilities>(() => {
    const baseCaps = getSubscriptionCapabilities(this.currentTier());
    
    // Premium subscribers get max photos from remote config
    const isPremium = this.currentTier() === 'premium';
    if (isPremium) {
      return {
        ...baseCaps,
        maxPhotos: this.remoteConfigService.premiumMaxPhotos(),
      };
    }
    
    return baseCaps;
  });

  readonly isActive = computed(() => {
    const sub = this._subscription();
    return sub?.status === 'active' || sub?.status === 'trialing';
  });

  readonly isPremium = computed(() => {
    return this.currentTier() === 'premium';
  });

  readonly pendingCancellation = computed(() => {
    const sub = this._subscription();
    
    // Check if subscription is scheduled to cancel
    if (!sub?.cancelAtPeriodEnd) {
      return null;
    }
    
    // Use cancelAt date if available, otherwise fall back to currentPeriodEnd
    const dateSource = sub.cancelAt || sub.currentPeriodEnd;
    
    if (!dateSource) {
      return null;
    }
    
    // Convert Firestore timestamp if needed
    let date: Date | null = null;
    if (typeof (dateSource as { toDate?: () => Date }).toDate === 'function') {
      date = (dateSource as { toDate: () => Date }).toDate();
    } else if (dateSource instanceof Date) {
      date = dateSource;
    }

    return {
      date,
      formattedDate: date?.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      }) || 'your next billing date',
    };
  });

  // Price info - uses Remote Config for dynamic pricing
  readonly priceMonthly = this.remoteConfigService.subscriptionMonthlyPriceCents;
  readonly price = computed(() => ({
    ...SUBSCRIPTION_PRICE,
    monthly: this.priceMonthly(),
  }));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Initialize real-time subscription to private user data
   * This should be called after authentication
   */
  initialize(): void {
    const user = this.authService.user();
    if (!user) {
      this._subscription.set(null);
      this._profileProgress.set(0);
      return;
    }

    // Ensure GA user id is associated with subscription/user properties
    this.analytics.setUser(user.uid);
    this.subscribeToPrivateData(user.uid);
  }

  private subscribeToPrivateData(userId: string): void {
    this.cleanup();
    this._loading.set(true);

    // Subscribe to real-time updates on private data
    this.unsubscribe = this.firestoreService.subscribeToDocument<PrivateUserData>(
      `users/${userId}/private`,
      'data',
      (data) => {
        if (data) {
          const newSubscription = data.subscription ?? { tier: 'free', status: 'active' };
          const newTier = newSubscription.tier === 'premium' ? 'premium' : 'free';
          
          // Detect subscription tier changes for analytics
          this.trackSubscriptionChange(newTier, newSubscription);
          
          this._subscription.set(newSubscription);
          this._profileProgress.set(data.profileProgress ?? 0);
          this._trustData.set(data.trust ?? null);
          this._reputationData.set(data.reputation ?? null);
          this._isFounder.set(data.isFounder ?? false);
          this._founderCity.set(data.founderCity ?? null);

          // Keep GA user properties in sync for Remote Config targeting/segmentation
          this.analytics.setUserProperties({
            subscription_tier: newTier,
            reputation_tier: data.reputation?.tier ?? 'new',
            is_founder: data.isFounder ?? false,
          });
        } else {
          // Private doc doesn't exist yet - default to free
          this._subscription.set({ tier: 'free', status: 'active' });
          this._profileProgress.set(0);
          this._trustData.set(null);
          this._reputationData.set(null);
          this._isFounder.set(false);
          this._founderCity.set(null);
          this.previousTier = 'free';

          // Keep GA user properties in sync for Remote Config targeting/segmentation
          this.analytics.setUserProperties({
            subscription_tier: 'free',
            reputation_tier: 'new',
            is_founder: false,
          });
        }
        this._loading.set(false);
      }
    );
  }

  /**
   * Track subscription tier changes for analytics and revenue attribution
   */
  private trackSubscriptionChange(newTier: SubscriptionTier, subscription: UserSubscription): void {
    // Skip if this is the first load (previousTier is null)
    if (this.previousTier === null) {
      this.previousTier = newTier;
      return;
    }

    // Check if tier actually changed
    if (this.previousTier !== newTier) {
      // Track general subscription change
      this.analytics.trackSubscriptionChanged(newTier, this.previousTier);

      // If upgrading to premium, track as subscription start (revenue event)
      if (newTier === 'premium' && this.previousTier === 'free') {
        /**
         * IMPORTANT:
         * Only log a revenue-bearing `purchase` event when we have a Stripe-backed subscription.
         *
         * Without a real `stripeSubscriptionId`, GA4/Firebase can't dedupe, and any accidental/manual
         * tier flips to premium would incorrectly show as revenue.
         */
        const isStripeBacked =
          (subscription.status === 'active' || subscription.status === 'trialing') &&
          typeof subscription.stripeSubscriptionId === 'string' &&
          subscription.stripeSubscriptionId.length > 0;

        if (isStripeBacked) {
          const priceInCents = this.priceMonthly();

          this.analytics.trackSubscriptionStart({
            subscriptionId: subscription.stripeSubscriptionId,
            tier: 'premium',
            priceInCents,
            currency: 'USD',
            source: 'upgrade_dialog',
          });
        }

        // Update user properties in analytics
        this.analytics.setUserProperties({
          subscription_tier: 'premium',
        });
      }

      // If downgrading (cancellation took effect)
      if (newTier === 'free' && this.previousTier === 'premium') {
        this.analytics.trackSubscriptionCancelled({
          tier: 'premium',
          reason: 'period_end',
        });

        // Update user properties in analytics
        this.analytics.setUserProperties({
          subscription_tier: 'free',
        });
      }

      this.previousTier = newTier;
    }
  }

  private cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * @deprecated Use initialize() instead for real-time updates
   */
  async loadSubscription(): Promise<void> {
    this.initialize();
  }

  /**
   * Check if user can perform an action, optionally showing upgrade modal
   */
  canPerformAction(action: keyof SubscriptionCapabilities, showUpgradePrompt = true): boolean {
    const caps = this.capabilities();
    const canDo = caps[action] as boolean;

    if (!canDo && showUpgradePrompt) {
      this.showUpgradePrompt(action);
    }

    return canDo;
  }

  /**
   * Show upgrade prompt for a specific feature
   */
  async showUpgradePrompt(feature?: keyof SubscriptionCapabilities): Promise<boolean> {
    // Dynamically import to avoid circular dependency
    const { UpgradeDialogComponent } = await import('../../components/upgrade-dialog/upgrade-dialog');
    
    const dialogRef = this.dialog.open(UpgradeDialogComponent, {
      panelClass: 'upgrade-dialog-panel',
      data: { feature },
      width: '480px',
      maxWidth: '95vw',
    });

    return new Promise((resolve) => {
      dialogRef.afterClosed().subscribe((result) => {
        resolve(result === true);
      });
    });
  }

  /**
   * Get display name for a tier
   */
  getTierDisplayName(tier: SubscriptionTier): string {
    return tier === 'premium' ? 'Premium' : 'Free';
  }

  /**
   * Get badge icon for a tier
   */
  getTierBadge(tier: SubscriptionTier): string {
    return tier === 'premium' ? 'star' : 'explore';
  }

  /**
   * Format price for display
   */
  formatPrice(cents: number): string {
    if (cents === 0) return 'Free';
    return `$${(cents / 100).toFixed(2)}`;
  }
}
