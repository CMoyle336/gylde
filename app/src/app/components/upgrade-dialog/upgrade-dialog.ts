import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SubscriptionCapabilities, SUBSCRIPTION_PLANS } from '../../core/interfaces';

interface UpgradeDialogData {
  feature?: keyof SubscriptionCapabilities;
}

const FEATURE_MESSAGES: Record<keyof SubscriptionCapabilities, { title: string; description: string; icon: string }> = {
  canMessage: {
    title: 'Unlock Messaging',
    description: 'Upgrade to Connect or Elite to send messages and start meaningful conversations.',
    icon: 'chat_bubble',
  },
  canVerifyProfile: {
    title: 'Verify Your Profile',
    description: 'Upgrade to Connect or Elite to verify your profile and build trust with other members.',
    icon: 'verified_user',
  },
  hasAIAssistant: {
    title: 'Unlock AI Assistant',
    description: 'Upgrade to Elite for an AI assistant that helps craft your profile and suggests conversation starters.',
    icon: 'auto_awesome',
  },
  hasVirtualPhone: {
    title: 'Get a Virtual Phone Number',
    description: 'Upgrade to Elite for a private virtual phone number to protect your real number while dating.',
    icon: 'phone_android',
  },
  hasPriorityVisibility: {
    title: 'Priority Visibility',
    description: 'Upgrade to Elite to appear first in search results and get more matches.',
    icon: 'trending_up',
  },
  canSeeWhoViewedProfile: {
    title: 'See Who Viewed You',
    description: 'Upgrade to Connect or Elite to see who has been viewing your profile.',
    icon: 'visibility',
  },
  maxPhotos: {
    title: 'Upload More Photos',
    description: 'Upgrade to add more photos and showcase more of yourself.',
    icon: 'photo_library',
  },
  canAccessPrivatePhotos: {
    title: 'Access Private Photos',
    description: 'Upgrade to request and share private photos with your connections.',
    icon: 'lock_open',
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
  ],
})
export class UpgradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UpgradeDialogComponent>);
  private readonly router = inject(Router);
  private readonly data = inject<UpgradeDialogData>(MAT_DIALOG_DATA, { optional: true });

  protected readonly plans = SUBSCRIPTION_PLANS.filter(p => p.id !== 'free');
  
  protected readonly featureInfo = this.data?.feature 
    ? FEATURE_MESSAGES[this.data.feature]
    : {
        title: 'Upgrade Your Experience',
        description: 'Unlock premium features to connect with more members.',
        icon: 'star',
      };

  protected close(): void {
    this.dialogRef.close();
  }

  protected goToSubscription(): void {
    this.dialogRef.close();
    this.router.navigate(['/subscription']);
  }

  protected formatPrice(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
