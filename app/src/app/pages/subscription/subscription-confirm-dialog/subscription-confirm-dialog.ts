import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { SubscriptionTier } from '../../../core/interfaces';

export interface SubscriptionConfirmDialogData {
  action: 'upgrade' | 'downgrade' | 'new' | 'interval-change';
  currentTier: SubscriptionTier;
  newTier: SubscriptionTier;
  newTierName: string;
  currentTierName: string;
  price: string;
  billingPeriod: 'monthly' | 'quarterly';
  currentBillingPeriod?: 'monthly' | 'quarterly';
}

@Component({
  selector: 'app-subscription-confirm-dialog',
  template: `
    <div class="confirm-dialog">
      <div class="dialog-header">
        <mat-icon [class.upgrade]="data.action === 'upgrade'" 
                  [class.downgrade]="data.action === 'downgrade'"
                  [class.interval-change]="data.action === 'interval-change'">
          {{ getIcon() }}
        </mat-icon>
        <h2>{{ getTitle() }}</h2>
      </div>

      <div class="dialog-content">
        @if (data.action === 'upgrade') {
          <p class="main-message">
            You're upgrading from <strong>{{ data.currentTierName }}</strong> to <strong>{{ data.newTierName }}</strong>.
          </p>
          <div class="info-box">
            <mat-icon>info</mat-icon>
            <div>
              <p>You'll be charged a prorated amount for the remainder of your billing period.</p>
              <p class="price-note">New price: <strong>{{ data.price }}</strong> {{ data.billingPeriod === 'quarterly' ? '/mo billed quarterly' : '/month' }}</p>
            </div>
          </div>
        } @else if (data.action === 'downgrade') {
          <p class="main-message">
            You're downgrading from <strong>{{ data.currentTierName }}</strong> to <strong>{{ data.newTierName }}</strong>.
          </p>
          <div class="info-box warning">
            <mat-icon>schedule</mat-icon>
            <div>
              <p>You'll keep your current <strong>{{ data.currentTierName }}</strong> features until the end of your billing period.</p>
              <p>After that, your plan will automatically switch to <strong>{{ data.newTierName }}</strong>.</p>
            </div>
          </div>
        } @else if (data.action === 'interval-change') {
          <p class="main-message">
            You're switching from <strong>{{ data.currentBillingPeriod }}</strong> to <strong>{{ data.billingPeriod }}</strong> billing.
          </p>
          <div class="info-box">
            <mat-icon>{{ data.billingPeriod === 'quarterly' ? 'savings' : 'calendar_month' }}</mat-icon>
            <div>
              @if (data.billingPeriod === 'quarterly') {
                <p>You'll save money with quarterly billing!</p>
              } @else {
                <p>You'll switch to monthly billing with more flexibility.</p>
              }
              <p>Your billing cycle will reset and you'll receive credit for any unused time.</p>
              <p class="price-note">New price: <strong>{{ data.price }}</strong> {{ data.billingPeriod === 'quarterly' ? '/mo billed quarterly' : '/month' }}</p>
            </div>
          </div>
        } @else {
          <p class="main-message">
            You're subscribing to <strong>{{ data.newTierName }}</strong>.
          </p>
          <div class="info-box">
            <mat-icon>credit_card</mat-icon>
            <div>
              <p>You'll be redirected to Stripe to complete your payment.</p>
              <p class="price-note">Price: <strong>{{ data.price }}</strong> {{ data.billingPeriod === 'quarterly' ? '/mo billed quarterly' : '/month' }}</p>
            </div>
          </div>
        }
      </div>

      <div class="dialog-actions">
        <button mat-button (click)="onCancel()">Cancel</button>
        <button mat-flat-button 
                [color]="data.action === 'downgrade' ? 'warn' : 'primary'"
                (click)="onConfirm()">
          {{ getConfirmButtonText() }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .confirm-dialog {
      padding: 1.5rem;
      background: var(--color-bg-secondary, #1a1720);
      border-radius: 16px;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .dialog-header mat-icon {
      font-size: 1.5rem;
      width: 1.5rem;
      height: 1.5rem;
      color: var(--color-accent, #c9a962);
    }

    .dialog-header mat-icon.upgrade {
      color: #10b981;
    }

    .dialog-header mat-icon.downgrade {
      color: #f59e0b;
    }

    .dialog-header mat-icon.interval-change {
      color: #3b82f6;
    }

    .dialog-header h2 {
      font-family: var(--font-display, system-ui);
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary, #f5f3f0);
      margin: 0;
      line-height: 1.3;
    }

    .dialog-content {
      margin-bottom: 1.5rem;
    }

    .main-message {
      font-size: 0.9375rem;
      color: var(--color-text-primary, #f5f3f0);
      margin: 0 0 1rem;
      line-height: 1.5;
    }

    .main-message strong {
      color: var(--color-accent, #c9a962);
      font-weight: 600;
    }

    .info-box {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--color-bg-elevated, #252230);
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      border-radius: 10px;
    }

    .info-box.warning {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.25);
    }

    .info-box mat-icon {
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      color: var(--color-accent, #c9a962);
      flex-shrink: 0;
      margin-top: 1px;
    }

    .info-box.warning mat-icon {
      color: #f59e0b;
    }

    .info-box > div {
      flex: 1;
      min-width: 0;
    }

    .info-box p {
      font-size: 0.875rem;
      color: var(--color-text-secondary, #a8a4b0);
      margin: 0;
      line-height: 1.5;
    }

    .info-box p + p {
      margin-top: 0.5rem;
    }

    .info-box p strong {
      color: var(--color-text-primary, #f5f3f0);
      font-weight: 600;
    }

    .price-note {
      color: var(--color-text-primary, #f5f3f0) !important;
    }

    .price-note strong {
      color: var(--color-accent, #c9a962) !important;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding-top: 0.5rem;
    }

    .dialog-actions button {
      min-width: 100px;
      border-radius: 8px;
      font-weight: 500;
    }

    /* Light mode overrides */
    :host-context(.light-mode) .confirm-dialog,
    :host-context([data-theme="light"]) .confirm-dialog {
      background: #ffffff;
    }

    :host-context(.light-mode) .dialog-header h2,
    :host-context([data-theme="light"]) .dialog-header h2 {
      color: #1a1720;
    }

    :host-context(.light-mode) .main-message,
    :host-context([data-theme="light"]) .main-message {
      color: #1a1720;
    }

    :host-context(.light-mode) .info-box,
    :host-context([data-theme="light"]) .info-box {
      background: #f5f5f5;
      border-color: #e0e0e0;
    }

    :host-context(.light-mode) .info-box.warning,
    :host-context([data-theme="light"]) .info-box.warning {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.3);
    }

    :host-context(.light-mode) .info-box p,
    :host-context([data-theme="light"]) .info-box p {
      color: #555555;
    }

    :host-context(.light-mode) .info-box p strong,
    :host-context([data-theme="light"]) .info-box p strong {
      color: #1a1720;
    }

    :host-context(.light-mode) .price-note,
    :host-context([data-theme="light"]) .price-note {
      color: #1a1720 !important;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
  ],
})
export class SubscriptionConfirmDialogComponent {
  protected readonly data = inject<SubscriptionConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SubscriptionConfirmDialogComponent>);

  protected getIcon(): string {
    switch (this.data.action) {
      case 'upgrade':
        return 'trending_up';
      case 'downgrade':
        return 'trending_down';
      case 'interval-change':
        return 'swap_horiz';
      default:
        return 'credit_card';
    }
  }

  protected getTitle(): string {
    switch (this.data.action) {
      case 'upgrade':
        return 'Confirm Upgrade';
      case 'downgrade':
        return 'Confirm Downgrade';
      case 'interval-change':
        return 'Change Billing Period';
      default:
        return 'Confirm Subscription';
    }
  }

  protected getConfirmButtonText(): string {
    switch (this.data.action) {
      case 'upgrade':
        return 'Upgrade Now';
      case 'downgrade':
        return 'Schedule Downgrade';
      case 'interval-change':
        return 'Switch Billing';
      default:
        return 'Subscribe';
    }
  }

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onConfirm(): void {
    this.dialogRef.close(true);
  }
}
