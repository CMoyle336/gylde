import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  OnDestroy,
  OnInit,
  Output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { environment } from '../../../environments/environment';
import { AuthService, UserProfileService, StripeService, AnalyticsService } from '../../core/services';

type VerificationStep = 'info' | 'payment' | 'verifying' | 'pending' | 'success' | 'failed';

@Component({
  selector: 'app-identity-verification',
  templateUrl: './identity-verification.html',
  styleUrl: './identity-verification.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class IdentityVerificationComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @Output() verificationStarted = new EventEmitter<string>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly stripeService = inject(StripeService);
  private readonly analytics = inject(AnalyticsService);
  private readonly functions = inject(Functions);

  protected readonly step = signal<VerificationStep>('info');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly price = environment.pricing?.identityVerification || 499;
  protected readonly priceFormatted = `$${(this.price / 100).toFixed(2)}`;

  protected readonly stripeConfigured = !!environment.stripe?.publishableKey;
  protected readonly veriffConfigured = !!environment.veriff?.apiKey;
  protected readonly isBrowser = isPlatformBrowser(this.platformId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private veriffInstance: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private veriffFrame: any = null;

  private paymentIntentId: string | null = null;

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // Check if user already has a verification status
    const profile = this.userProfileService.profile();
    
    // Already verified - show success
    if (profile?.identityVerified) {
      this.step.set('success');
      return;
    }
    
    // Verification in progress - show pending
    if (profile?.identityVerificationStatus === 'pending') {
      this.step.set('pending');
      return;
    }

    // User has paid but verification was cancelled or failed - go straight to verification
    // (they already paid, so skip the payment step)
    if (profile?.identityVerificationPaid) {
      this.step.set('verifying');
      setTimeout(() => this.initializeVeriff(), 100);
      return;
    }
    
    // Default: show info step (user hasn't paid yet)
  }

  ngOnDestroy(): void {
    this.stripeService.cleanup();
    if (this.veriffFrame?.close) {
      this.veriffFrame.close();
    }
  }

  /**
   * Move to payment step
   */
  protected async startPayment(): Promise<void> {
    if (!this.stripeConfigured) {
      // Skip payment in dev mode if Stripe not configured
      this.error.set('Payment system not configured. In development, you may skip this step.');
      return;
    }

    // Track checkout initiation for identity verification
    this.analytics.trackCheckoutInitiated({
      tier: 'identity_verification',
      priceInCents: this.price,
      currency: 'USD',
    });

    this.loading.set(true);
    this.error.set(null);

    try {
      // Initialize Stripe
      const initialized = await this.stripeService.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize payment system');
      }

      this.step.set('payment');

      // Create card element after step change (next tick)
      setTimeout(async () => {
        await this.stripeService.createCardElement('card-element');
        this.loading.set(false);
      }, 100);
    } catch (err) {
      console.error('Error starting payment:', err);
      this.error.set('Failed to initialize payment. Please try again.');
      this.loading.set(false);
    }
  }

  /**
   * Process the payment
   */
  protected async processPayment(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      // Create payment intent
      const intentResult = await this.stripeService.createVerificationPaymentIntent();
      if (!intentResult) {
        throw new Error('Failed to create payment');
      }

      this.paymentIntentId = intentResult.paymentIntentId;

      // Confirm the payment
      const paymentResult = await this.stripeService.confirmPayment(intentResult.clientSecret);

      if (!paymentResult.success) {
        throw new Error(paymentResult.error || 'Payment failed');
      }

      // Confirm payment on server side
      const confirmPayment = httpsCallable(this.functions, 'confirmPayment');
      await confirmPayment({ 
        paymentIntentId: this.paymentIntentId,
        type: 'identity_verification',
      });

      // Track the identity verification purchase for revenue
      this.analytics.trackOneTimePurchase({
        transactionId: this.paymentIntentId || undefined,
        itemName: 'Identity Verification',
        priceInCents: this.price,
        currency: 'USD',
      });

      // Refresh profile to get updated identityVerificationPaid status
      const user = this.authService.user();
      if (user?.uid) {
        await this.userProfileService.loadUserProfile(user.uid);
      }

      // Payment successful - move to verification
      this.stripeService.cleanup();
      this.step.set('verifying');
      
      // Initialize Veriff
      setTimeout(() => this.initializeVeriff(), 100);
    } catch (err) {
      console.error('Payment error:', err);
      this.error.set(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      this.loading.set(false);
    }
  }

  /**
   * Initialize Veriff for identity verification
   */
  private async initializeVeriff(): Promise<void> {
    if (!this.veriffConfigured) {
      this.error.set('Identity verification is not configured.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      // Dynamic import Veriff SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [veriffModule, incontextModule]: [any, any] = await Promise.all([
        import('@veriff/js-sdk'),
        import('@veriff/incontext-sdk'),
      ]);

      const Veriff = veriffModule.Veriff || veriffModule.default?.Veriff || veriffModule.default;
      const createVeriffFrame = incontextModule.createVeriffFrame || incontextModule.default?.createVeriffFrame;
      const MESSAGES = incontextModule.MESSAGES || incontextModule.default?.MESSAGES;

      if (!Veriff || typeof Veriff !== 'function') {
        throw new Error('Veriff SDK not found');
      }

      const user = this.authService.user();
      const userProfile = this.userProfileService.profile();

      // Extract names
      const displayName = userProfile?.displayName || user?.displayName || '';
      const nameParts = displayName.split(' ');
      const givenName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      this.veriffInstance = Veriff({
        apiKey: environment.veriff.apiKey,
        parentId: 'veriff-root',
        onSession: (err: Error | null, response: { verification?: { id: string; url: string } }) => {
          if (err) {
            console.error('Veriff session error:', err);
            this.error.set('Failed to start verification. Please try again.');
            this.loading.set(false);
            return;
          }

          if (response?.verification?.url) {
            const sessionId = response.verification.id;
            this.verificationStarted.emit(sessionId);

            // Update user profile
            this.userProfileService.updateProfile({
              identityVerificationSessionId: sessionId,
              identityVerificationStatus: 'pending',
            }).catch(console.error);

            // Show in-context verification
            this.veriffFrame = createVeriffFrame({
              url: response.verification.url,
              onEvent: (msg: string) => {
                switch (msg) {
                  case MESSAGES.STARTED:
                    console.log('Veriff started');
                    break;
                  case MESSAGES.FINISHED:
                    console.log('Veriff finished');
                    this.step.set('pending');
                    break;
                  case MESSAGES.CANCELED:
                    console.log('Veriff canceled');
                    this.userProfileService.updateProfile({
                      identityVerificationStatus: 'cancelled',
                    }).catch(console.error);
                    // Stay on verifying step - they already paid
                    break;
                }
              },
            });
          }
        },
      });

      if (givenName || lastName) {
        this.veriffInstance.setParams({
          person: {
            givenName: givenName || ' ',
            lastName: lastName || ' ',
          },
          vendorData: user?.uid || '',
        });
      }

      this.veriffInstance.mount({
        submitBtnText: 'Start Verification',
        loadingText: 'Please wait...',
      });

      this.loading.set(false);
    } catch (err) {
      console.error('Failed to initialize Veriff:', err);
      this.error.set('Failed to initialize verification. Please try again.');
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected goBack(): void {
    const currentStep = this.step();
    if (currentStep === 'payment') {
      this.stripeService.cleanup();
      this.step.set('info');
      this.error.set(null);
    }
  }
}
