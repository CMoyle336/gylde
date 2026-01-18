import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import {
  SubscriptionTier,
  UserSubscription,
  SubscriptionCapabilities,
  getSubscriptionCapabilities,
  SUBSCRIPTION_PLANS,
  TrustData,
} from '../interfaces';

/**
 * Private user data structure (stored in users/{uid}/private/data)
 */
interface PrivateUserData {
  profileProgress: number;
  trust?: TrustData;
  subscription: UserSubscription;
  updatedAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private readonly authService = inject(AuthService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Current subscription state - loaded from private subcollection
  private readonly _subscription = signal<UserSubscription | null>(null);
  private readonly _profileProgress = signal<number>(0);
  private readonly _trustData = signal<TrustData | null>(null);
  private readonly _loading = signal(false);
  private unsubscribe: (() => void) | null = null;

  // Public signals
  readonly subscription = this._subscription.asReadonly();
  readonly profileProgress = this._profileProgress.asReadonly();
  readonly trustData = this._trustData.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly currentTier = computed<SubscriptionTier>(() => {
    return this._subscription()?.tier ?? 'free';
  });

  readonly capabilities = computed<SubscriptionCapabilities>(() => {
    return getSubscriptionCapabilities(this.currentTier());
  });

  readonly isActive = computed(() => {
    const sub = this._subscription();
    return sub?.status === 'active' || sub?.status === 'trialing';
  });

  readonly isPremium = computed(() => {
    const tier = this.currentTier();
    return tier === 'plus' || tier === 'elite';
  });

  readonly isElite = computed(() => {
    return this.currentTier() === 'elite';
  });

  readonly currentBillingInterval = computed(() => {
    const sub = this._subscription();
    
    // Use stored billing interval if available
    if (sub?.billingInterval) {
      return sub.billingInterval;
    }
    
    // Infer from period dates if billingInterval not stored (for existing subscriptions)
    if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      
      // Convert Firestore timestamps
      if (typeof (sub.currentPeriodStart as { toDate?: () => Date }).toDate === 'function') {
        startDate = (sub.currentPeriodStart as { toDate: () => Date }).toDate();
      } else if (sub.currentPeriodStart instanceof Date) {
        startDate = sub.currentPeriodStart;
      }
      
      if (typeof (sub.currentPeriodEnd as { toDate?: () => Date }).toDate === 'function') {
        endDate = (sub.currentPeriodEnd as { toDate: () => Date }).toDate();
      } else if (sub.currentPeriodEnd instanceof Date) {
        endDate = sub.currentPeriodEnd;
      }
      
      if (startDate && endDate) {
        // Calculate days between dates
        const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        // Quarterly is ~90 days, monthly is ~30 days
        return daysDiff > 60 ? 'quarterly' : 'monthly';
      }
    }
    
    return null;
  });

  readonly pendingDowngrade = computed(() => {
    const sub = this._subscription();
    
    // Don't show pending downgrade if subscription is set to cancel entirely
    if (!sub?.pendingDowngradeTier || !sub?.pendingDowngradeDate || sub?.cancelAtPeriodEnd) {
      return null;
    }
    
    // Convert Firestore timestamp if needed
    let date: Date | null = null;
    if (sub.pendingDowngradeDate) {
      if (typeof (sub.pendingDowngradeDate as { toDate?: () => Date }).toDate === 'function') {
        date = (sub.pendingDowngradeDate as { toDate: () => Date }).toDate();
      } else if (sub.pendingDowngradeDate instanceof Date) {
        date = sub.pendingDowngradeDate;
      }
    }

    return {
      tier: sub.pendingDowngradeTier,
      date,
      formattedDate: date?.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      }) || 'your next billing date',
    };
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
      currentTier: sub.tier,
      date,
      formattedDate: date?.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      }) || 'your next billing date',
    };
  });

  readonly plans = SUBSCRIPTION_PLANS;

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
          this._subscription.set(data.subscription ?? { tier: 'free', status: 'active' });
          this._profileProgress.set(data.profileProgress ?? 0);
          this._trustData.set(data.trust ?? null);
        } else {
          // Private doc doesn't exist yet - default to free
          this._subscription.set({ tier: 'free', status: 'active' });
          this._profileProgress.set(0);
          this._trustData.set(null);
        }
        this._loading.set(false);
      }
    );
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
  async showUpgradePrompt(feature?: keyof SubscriptionCapabilities): Promise<void> {
    // Dynamically import to avoid circular dependency
    const { UpgradeDialogComponent } = await import('../../components/upgrade-dialog/upgrade-dialog');
    
    this.dialog.open(UpgradeDialogComponent, {
      panelClass: 'upgrade-dialog-panel',
      data: { feature },
      width: '480px',
      maxWidth: '95vw',
    });
  }

  /**
   * Navigate to subscription page
   */
  goToSubscriptionPage(): void {
    this.router.navigate(['/subscription']);
  }

  /**
   * Get display name for a tier
   */
  getTierDisplayName(tier: SubscriptionTier): string {
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === tier);
    return plan?.name ?? 'Free';
  }

  /**
   * Get badge icon for a tier
   */
  getTierBadge(tier: SubscriptionTier): string {
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === tier);
    return plan?.badge ?? 'explore';
  }

  /**
   * Format price for display
   */
  formatPrice(cents: number): string {
    if (cents === 0) return 'Free';
    return `$${(cents / 100).toFixed(2)}`;
  }

  /**
   * Format monthly price from quarterly total
   */
  formatMonthlyFromQuarterly(quarterlyCents: number): string {
    if (quarterlyCents === 0) return 'Free';
    const monthly = quarterlyCents / 3 / 100;
    return `$${monthly.toFixed(2)}`;
  }
}
