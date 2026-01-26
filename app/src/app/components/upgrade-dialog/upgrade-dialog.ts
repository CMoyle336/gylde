import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SubscriptionCapabilities, PREMIUM_FEATURES } from '../../core/interfaces';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

interface UpgradeDialogData {
  feature?: keyof SubscriptionCapabilities;
}

const FEATURE_MESSAGES: Partial<
  Record<keyof SubscriptionCapabilities, { titleKey: string; descriptionKey: string; icon: string }>
> = {
  unlimitedMessaging: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.UNLIMITED_MESSAGING.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.UNLIMITED_MESSAGING.DESCRIPTION',
    icon: 'forum',
  },
  canMessageAnyTier: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_MESSAGE_ANY_TIER.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_MESSAGE_ANY_TIER.DESCRIPTION',
    icon: 'forum',
  },
  hasAIAssistant: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.HAS_AI_ASSISTANT.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.HAS_AI_ASSISTANT.DESCRIPTION',
    icon: 'auto_awesome',
  },
  hasVirtualPhone: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.HAS_VIRTUAL_PHONE.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.HAS_VIRTUAL_PHONE.DESCRIPTION',
    icon: 'phone_android',
  },
  priorityVisibility: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.PRIORITY_VISIBILITY.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.PRIORITY_VISIBILITY.DESCRIPTION',
    icon: 'trending_up',
  },
  canSeeWhoViewedProfile: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_SEE_WHO_VIEWED_PROFILE.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_SEE_WHO_VIEWED_PROFILE.DESCRIPTION',
    icon: 'visibility',
  },
  canSeeWhoFavorited: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_SEE_WHO_FAVORITED.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_SEE_WHO_FAVORITED.DESCRIPTION',
    icon: 'favorite',
  },
  maxPhotos: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.MAX_PHOTOS.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.MAX_PHOTOS.DESCRIPTION',
    icon: 'photo_library',
  },
  canAccessPrivatePhotos: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_ACCESS_PRIVATE_PHOTOS.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.CAN_ACCESS_PRIVATE_PHOTOS.DESCRIPTION',
    icon: 'lock_open',
  },
  advancedFilters: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.ADVANCED_FILTERS.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.ADVANCED_FILTERS.DESCRIPTION',
    icon: 'tune',
  },
  readReceipts: {
    titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.READ_RECEIPTS.TITLE',
    descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.READ_RECEIPTS.DESCRIPTION',
    icon: 'done_all',
  },
};

@Component({
  selector: 'app-upgrade-dialog',
  templateUrl: './upgrade-dialog.html',
  styleUrl: './upgrade-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslateModule,
  ],
})
export class UpgradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UpgradeDialogComponent>);
  private readonly functions = inject(Functions);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly analytics = inject(AnalyticsService);
  private readonly data = inject<UpgradeDialogData>(MAT_DIALOG_DATA, { optional: true });
  private readonly translate = inject(TranslateService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly price = this.subscriptionService.price;
  protected readonly priceFormatted = computed(() => `$${(this.price().monthly / 100).toFixed(2)}`);
  protected readonly features = PREMIUM_FEATURES;
  
  protected readonly featureInfo: { titleKey: string; descriptionKey: string; icon: string } = 
    (this.data?.feature && FEATURE_MESSAGES[this.data.feature]) ?? {
      titleKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.GENERAL.TITLE',
      descriptionKey: 'UPGRADE_DIALOG.FEATURE_MESSAGES.GENERAL.DESCRIPTION',
      icon: 'star',
    };

  constructor() {
    // Track dialog opened
    this.analytics.trackUpgradePromptShown(this.data?.feature || 'general');
  }

  protected close(): void {
    this.dialogRef.close(false);
  }

  protected async subscribe(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    // Track upgrade button clicked
    this.analytics.trackUpgradeStarted(this.data?.feature || 'upgrade_dialog');

    try {
      const createCheckout = httpsCallable<
        { tier: 'premium' },
        { sessionId?: string; url?: string; updated?: boolean; message?: string }
      >(this.functions, 'createSubscriptionCheckout');

      const result = await createCheckout({ tier: 'premium' });

      // Check if this was a direct subscription update (already subscribed)
      if (result.data.updated) {
        this.dialogRef.close(true);
        return;
      }

      // Redirect to Stripe Checkout - track checkout initiation
      if (result.data.url) {
        this.analytics.trackCheckoutInitiated({
          tier: 'premium',
          priceInCents: this.price().monthly,
          currency: 'USD',
        });
        window.location.href = result.data.url;
      }
    } catch (err: unknown) {
      console.error('Error creating checkout:', err);
      const error = err as { code?: string; message?: string };
      if (error.code === 'already-exists') {
        this.error.set(this.translate.instant('UPGRADE_DIALOG.ERRORS.ALREADY_PREMIUM'));
      } else {
        this.error.set(this.translate.instant('UPGRADE_DIALOG.ERRORS.CHECKOUT_FAILED'));
      }
      this.loading.set(false);
    }
  }
}
