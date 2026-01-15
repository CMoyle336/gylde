import { Injectable, inject, signal, computed } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { FirestoreService } from './firestore.service';
import {
  SubscriptionTier,
  UserSubscription,
  SubscriptionCapabilities,
  getSubscriptionCapabilities,
  SUBSCRIPTION_PLANS,
} from '../interfaces/subscription.interface';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  // Current subscription state
  private readonly _subscription = signal<UserSubscription | null>(null);
  private readonly _loading = signal(false);

  // Public signals
  readonly subscription = this._subscription.asReadonly();
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

  /**
   * Load user's subscription from their profile
   */
  async loadSubscription(): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      this._subscription.set(null);
      return;
    }

    this._loading.set(true);
    try {
      const profile = await this.userProfileService.getCurrentUserProfile();
      if (profile?.subscription) {
        this._subscription.set(profile.subscription as UserSubscription);
      } else {
        // Default to free tier
        this._subscription.set({
          tier: 'free',
          status: 'active',
        });
      }
    } catch (error) {
      console.error('Error loading subscription:', error);
      this._subscription.set({ tier: 'free', status: 'active' });
    } finally {
      this._loading.set(false);
    }
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
