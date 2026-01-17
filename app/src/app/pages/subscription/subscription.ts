import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { SubscriptionService } from '../../core/services/subscription.service';
import { SUBSCRIPTION_PLANS, SubscriptionPlan, SubscriptionTier } from '../../core/interfaces';
import { SubscriptionConfirmDialogComponent, SubscriptionConfirmDialogData } from './subscription-confirm-dialog/subscription-confirm-dialog';

@Component({
  selector: 'app-subscription',
  templateUrl: './subscription.html',
  styleUrl: './subscription.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class SubscriptionComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly functions = inject(Functions);
  private readonly dialog = inject(MatDialog);
  protected readonly subscriptionService = inject(SubscriptionService);

  protected readonly plans = SUBSCRIPTION_PLANS;
  protected readonly billingPeriod = signal<'monthly' | 'quarterly'>('quarterly');
  protected readonly currentTier = this.subscriptionService.currentTier;
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  protected readonly savingsPercent = computed(() => {
    // Calculate savings for quarterly vs monthly
    const plusPlan = this.plans.find(p => p.id === 'plus');
    if (!plusPlan || plusPlan.monthlyPrice === 0) return 0;
    const monthlyTotal = plusPlan.monthlyPrice * 3;
    const quarterlyTotal = plusPlan.quarterlyPrice;
    return Math.round((1 - quarterlyTotal / monthlyTotal) * 100);
  });

  protected readonly hasActiveSubscription = computed(() => {
    const tier = this.currentTier();
    return tier !== 'free';
  });

  protected readonly pendingDowngrade = this.subscriptionService.pendingDowngrade;
  protected readonly pendingCancellation = this.subscriptionService.pendingCancellation;

  ngOnInit(): void {
    // Check for success/cancel query params from Stripe redirect
    this.route.queryParams.subscribe(params => {
      if (params['success'] === 'true') {
        this.successMessage.set('Subscription activated successfully! Welcome to your new plan.');
        // Clear the URL params
        this.router.navigate([], { 
          relativeTo: this.route, 
          queryParams: {},
          replaceUrl: true 
        });
      } else if (params['canceled'] === 'true') {
        this.error.set('Subscription checkout was canceled.');
        this.router.navigate([], { 
          relativeTo: this.route, 
          queryParams: {},
          replaceUrl: true 
        });
      }
    });
  }

  protected toggleBillingPeriod(): void {
    this.billingPeriod.update(p => p === 'monthly' ? 'quarterly' : 'monthly');
  }

  protected getPrice(plan: SubscriptionPlan): string {
    if (plan.monthlyPrice === 0) return 'Free';
    
    if (this.billingPeriod() === 'quarterly') {
      const monthlyFromQuarterly = plan.quarterlyPrice / 3;
      return this.subscriptionService.formatPrice(monthlyFromQuarterly);
    }
    return this.subscriptionService.formatPrice(plan.monthlyPrice);
  }

  protected getBillingLabel(plan: SubscriptionPlan): string {
    if (plan.monthlyPrice === 0) return 'Forever';
    return this.billingPeriod() === 'quarterly' ? '/mo billed quarterly' : '/month';
  }

  protected isCurrentPlan(tier: SubscriptionTier): boolean {
    const currentTier = this.currentTier();
    if (currentTier !== tier) return false;
    
    // If same tier but different billing interval, don't consider it "current"
    // so the button remains clickable for interval changes
    const currentBillingInterval = this.subscriptionService.currentBillingInterval();
    const selectedBillingPeriod = this.billingPeriod();
    if (currentTier !== 'free' && currentBillingInterval && currentBillingInterval !== selectedBillingPeriod) {
      return false;
    }
    
    return true;
  }

  protected canUpgrade(tier: SubscriptionTier): boolean {
    const tierOrder: SubscriptionTier[] = ['free', 'plus', 'elite'];
    const currentIndex = tierOrder.indexOf(this.currentTier());
    const targetIndex = tierOrder.indexOf(tier);
    return targetIndex > currentIndex;
  }

  protected getButtonLabel(tier: SubscriptionTier): string {
    const currentTier = this.currentTier();
    const currentBillingInterval = this.subscriptionService.currentBillingInterval();
    const selectedBillingPeriod = this.billingPeriod();
    
    // Check if this is the current tier but different interval
    if (currentTier === tier && currentTier !== 'free') {
      if (currentBillingInterval && currentBillingInterval !== selectedBillingPeriod) {
        return 'Switch Billing';
      }
      return 'Current Plan';
    }
    
    if (this.canUpgrade(tier)) return 'Upgrade';
    return 'Downgrade';
  }

  protected async selectPlan(plan: SubscriptionPlan): Promise<void> {
    if (plan.id === 'free') {
      // For downgrading to free, open the customer portal
      await this.manageSubscription();
      return;
    }

    // Determine the action type
    const currentTier = this.currentTier();
    const isUpgrade = this.canUpgrade(plan.id);
    const hasExistingSubscription = currentTier !== 'free';
    const currentBillingInterval = this.subscriptionService.currentBillingInterval();
    const selectedBillingPeriod = this.billingPeriod();
    
    // Detect if this is an interval change (same tier, different billing period)
    const isSameTier = currentTier === plan.id;
    const isIntervalChange = isSameTier && hasExistingSubscription && 
      currentBillingInterval !== null && currentBillingInterval !== selectedBillingPeriod;
    
    // If clicking current plan with same interval, do nothing
    if (isSameTier && !isIntervalChange) return;

    let action: 'upgrade' | 'downgrade' | 'new' | 'interval-change';
    if (isIntervalChange) {
      action = 'interval-change';
    } else if (!hasExistingSubscription) {
      action = 'new';
    } else if (isUpgrade) {
      action = 'upgrade';
    } else {
      action = 'downgrade';
    }

    // Show confirmation dialog
    const dialogData: SubscriptionConfirmDialogData = {
      action,
      currentTier,
      newTier: plan.id,
      currentTierName: this.getPlanName(currentTier),
      newTierName: plan.name,
      price: this.getPrice(plan),
      billingPeriod: selectedBillingPeriod,
      currentBillingPeriod: currentBillingInterval || undefined,
    };

    const dialogRef = this.dialog.open(SubscriptionConfirmDialogComponent, {
      data: dialogData,
      panelClass: 'subscription-confirm-dialog',
      maxWidth: '480px',
      width: '95vw',
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) return;

    // Proceed with the subscription change
    this.loading.set(true);
    this.error.set(null);

    try {
      const createCheckout = httpsCallable<
        { tier: SubscriptionTier; interval: 'monthly' | 'quarterly' },
        { sessionId?: string; url?: string; updated?: boolean; message?: string }
      >(this.functions, 'createSubscriptionCheckout');

      const result = await createCheckout({
        tier: plan.id,
        interval: this.billingPeriod(),
      });

      // Check if this was a direct subscription update (upgrade/downgrade)
      if (result.data.updated) {
        this.successMessage.set(result.data.message || 'Subscription updated successfully!');
        this.loading.set(false);
        // The subscription service will update automatically via real-time listener
        return;
      }

      // Redirect to Stripe Checkout for new subscriptions
      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err: unknown) {
      console.error('Error creating checkout:', err);
      // Check for specific error codes
      const error = err as { code?: string; message?: string };
      if (error.code === 'already-exists') {
        // Show the specific message from the server
        this.error.set(error.message || 'You are already subscribed to this plan.');
      } else {
        this.error.set('Failed to start checkout. Please try again.');
      }
      this.loading.set(false);
    }
  }

  protected async manageSubscription(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const createPortal = httpsCallable<void, { url: string }>(
        this.functions, 
        'createCustomerPortal'
      );

      const result = await createPortal();

      // Redirect to Stripe Customer Portal
      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err) {
      console.error('Error creating customer portal:', err);
      this.error.set('Failed to open subscription management. Please try again.');
      this.loading.set(false);
    }
  }

  protected goBack(): void {
    this.router.navigate(['/settings']);
  }

  protected dismissError(): void {
    this.error.set(null);
  }

  protected dismissSuccess(): void {
    this.successMessage.set(null);
  }

  protected getPlanName(tier: SubscriptionTier): string {
    const plan = this.plans.find(p => p.id === tier);
    return plan?.name || tier;
  }
}
