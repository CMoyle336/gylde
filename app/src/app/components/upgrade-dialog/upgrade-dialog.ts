import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { 
  SubscriptionCapabilities, 
  SUBSCRIPTION_PRICE, 
  PREMIUM_FEATURES 
} from '../../core/interfaces';

interface UpgradeDialogData {
  feature?: keyof SubscriptionCapabilities;
}

const FEATURE_MESSAGES: Partial<Record<keyof SubscriptionCapabilities, { title: string; description: string; icon: string }>> = {
  unlimitedMessaging: {
    title: 'Unlimited Messaging',
    description: 'Send unlimited messages without daily limits based on your reputation tier.',
    icon: 'chat_bubble',
  },
  canMessageAnyTier: {
    title: 'Message Anyone',
    description: 'Message any member regardless of their reputation tier.',
    icon: 'send',
  },
  hasAIAssistant: {
    title: 'AI Assistant',
    description: 'Get an AI assistant that helps craft your profile and suggests conversation starters.',
    icon: 'auto_awesome',
  },
  hasVirtualPhone: {
    title: 'Virtual Phone Number',
    description: 'Get a private virtual phone number to protect your real number while dating.',
    icon: 'phone_android',
  },
  priorityVisibility: {
    title: 'Priority Visibility',
    description: 'Appear first in search results and get more matches.',
    icon: 'trending_up',
  },
  canSeeWhoViewedProfile: {
    title: 'See Who Viewed You',
    description: 'See who has been viewing your profile.',
    icon: 'visibility',
  },
  canSeeWhoFavorited: {
    title: 'See Who Favorited You',
    description: 'See who has added you to their favorites.',
    icon: 'favorite',
  },
  maxPhotos: {
    title: 'Upload More Photos',
    description: 'Upload up to 10 photos to showcase more of yourself.',
    icon: 'photo_library',
  },
  canAccessPrivatePhotos: {
    title: 'Access Private Photos',
    description: 'Request and share private photos with your connections.',
    icon: 'lock_open',
  },
  advancedFilters: {
    title: 'Advanced Filters',
    description: 'Use advanced filters like income, education, and more to find your perfect match.',
    icon: 'tune',
  },
  readReceipts: {
    title: 'Read Receipts',
    description: 'Know when your messages have been read.',
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
  ],
})
export class UpgradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UpgradeDialogComponent>);
  private readonly functions = inject(Functions);
  private readonly data = inject<UpgradeDialogData>(MAT_DIALOG_DATA, { optional: true });

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly price = SUBSCRIPTION_PRICE;
  protected readonly priceFormatted = `$${(SUBSCRIPTION_PRICE.monthly / 100).toFixed(2)}`;
  protected readonly features = PREMIUM_FEATURES;
  
  protected readonly featureInfo: { title: string; description: string; icon: string } = 
    (this.data?.feature && FEATURE_MESSAGES[this.data.feature]) ?? {
      title: 'Upgrade to Premium',
      description: 'Unlock all premium features for the best Gylde experience.',
      icon: 'star',
    };

  protected close(): void {
    this.dialogRef.close(false);
  }

  protected async subscribe(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

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

      // Redirect to Stripe Checkout
      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err: unknown) {
      console.error('Error creating checkout:', err);
      const error = err as { code?: string; message?: string };
      if (error.code === 'already-exists') {
        this.error.set(error.message || 'You are already a premium subscriber.');
      } else {
        this.error.set('Failed to start checkout. Please try again.');
      }
      this.loading.set(false);
    }
  }
}
