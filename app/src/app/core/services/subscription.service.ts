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
  trustScore: number;
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
  private readonly _trustScore = signal<number>(0);
  private readonly _trustData = signal<TrustData | null>(null);
  private readonly _loading = signal(false);
  private unsubscribe: (() => void) | null = null;

  // Public signals
  readonly subscription = this._subscription.asReadonly();
  readonly trustScore = this._trustScore.asReadonly();
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
      this._trustScore.set(0);
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
          this._trustScore.set(data.trustScore ?? 0);
          this._trustData.set(data.trust ?? null);
        } else {
          // Private doc doesn't exist yet - default to free
          this._subscription.set({ tier: 'free', status: 'active' });
          this._trustScore.set(0);
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
   * Format monthly price from yearly total
   */
  formatMonthlyFromYearly(yearlyCents: number): string {
    if (yearlyCents === 0) return 'Free';
    const monthly = yearlyCents / 12 / 100;
    return `$${monthly.toFixed(2)}`;
  }
}
