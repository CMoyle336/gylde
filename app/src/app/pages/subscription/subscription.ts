import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SubscriptionService } from '../../core/services/subscription.service';
import { SUBSCRIPTION_PLANS, SubscriptionPlan, SubscriptionTier } from '../../core/interfaces';

@Component({
  selector: 'app-subscription',
  templateUrl: './subscription.html',
  styleUrl: './subscription.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
  ],
})
export class SubscriptionComponent {
  private readonly router = inject(Router);
  protected readonly subscriptionService = inject(SubscriptionService);

  protected readonly plans = SUBSCRIPTION_PLANS;
  protected readonly billingPeriod = signal<'monthly' | 'quarterly'>('quarterly');
  protected readonly currentTier = this.subscriptionService.currentTier;

  protected readonly savingsPercent = computed(() => {
    // Calculate savings for quarterly vs monthly
    const plusPlan = this.plans.find(p => p.id === 'plus');
    if (!plusPlan || plusPlan.monthlyPrice === 0) return 0;
    const monthlyTotal = plusPlan.monthlyPrice * 3;
    const quarterlyTotal = plusPlan.quarterlyPrice;
    return Math.round((1 - quarterlyTotal / monthlyTotal) * 100);
  });

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
    return this.currentTier() === tier;
  }

  protected canUpgrade(tier: SubscriptionTier): boolean {
    const tierOrder: SubscriptionTier[] = ['free', 'plus', 'elite'];
    const currentIndex = tierOrder.indexOf(this.currentTier());
    const targetIndex = tierOrder.indexOf(tier);
    return targetIndex > currentIndex;
  }

  protected getButtonLabel(tier: SubscriptionTier): string {
    if (this.isCurrentPlan(tier)) return 'Current Plan';
    if (this.canUpgrade(tier)) return 'Upgrade';
    return 'Downgrade';
  }

  protected selectPlan(plan: SubscriptionPlan): void {
    if (this.isCurrentPlan(plan.id)) return;
    
    // TODO: Implement Stripe checkout
    console.log('Selected plan:', plan.id, 'Billing:', this.billingPeriod());
    alert(`Stripe checkout would open for ${plan.name} (${this.billingPeriod()} billing)`);
  }

  protected goBack(): void {
    this.router.navigate(['/settings']);
  }
}
