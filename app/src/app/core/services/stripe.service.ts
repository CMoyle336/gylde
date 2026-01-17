import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { loadStripe, Stripe, StripeElements, StripeCardElement } from '@stripe/stripe-js';
import { environment } from '../../../environments/environment';

export interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
}

export interface PaymentResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class StripeService {
  private readonly functions = inject(Functions);
  private readonly platformId = inject(PLATFORM_ID);

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;

  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _initialized = signal(false);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly initialized = this._initialized.asReadonly();

  /**
   * Check if Stripe is configured
   */
  get isConfigured(): boolean {
    return !!environment.stripe?.publishableKey;
  }

  /**
   * Initialize Stripe.js and create Elements
   */
  async initialize(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    if (this._initialized()) {
      return true;
    }

    if (!this.isConfigured) {
      this._error.set('Stripe is not configured. Please add your publishable key.');
      return false;
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      this.stripe = await loadStripe(environment.stripe.publishableKey);
      
      if (!this.stripe) {
        throw new Error('Failed to load Stripe');
      }

      this._initialized.set(true);
      return true;
    } catch (err) {
      console.error('Error initializing Stripe:', err);
      this._error.set('Failed to initialize payment system');
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Create Elements and mount card element to a container
   */
  async createCardElement(containerId: string): Promise<StripeCardElement | null> {
    if (!this.stripe) {
      await this.initialize();
    }

    if (!this.stripe) {
      return null;
    }

    try {
      this.elements = this.stripe.elements({
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: '#c9a962',
            colorBackground: '#1a1a1a',
            colorText: '#ffffff',
            colorDanger: '#ef4444',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            borderRadius: '8px',
          },
        },
      });

      this.cardElement = this.elements.create('card', {
        style: {
          base: {
            fontSize: '16px',
            color: '#ffffff',
            '::placeholder': {
              color: '#9ca3af',
            },
          },
          invalid: {
            color: '#ef4444',
          },
        },
      });

      const container = document.getElementById(containerId);
      if (container) {
        this.cardElement.mount(`#${containerId}`);
      }

      return this.cardElement;
    } catch (err) {
      console.error('Error creating card element:', err);
      this._error.set('Failed to create payment form');
      return null;
    }
  }

  /**
   * Create a payment intent for identity verification
   */
  async createVerificationPaymentIntent(): Promise<PaymentIntentResponse | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const createPaymentIntent = httpsCallable<
        { type: string },
        PaymentIntentResponse
      >(this.functions, 'createPaymentIntent');

      const result = await createPaymentIntent({ type: 'identity_verification' });
      return result.data;
    } catch (err) {
      console.error('Error creating payment intent:', err);
      this._error.set('Failed to initialize payment. Please try again.');
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Confirm the payment using the card element
   */
  async confirmPayment(clientSecret: string): Promise<PaymentResult> {
    if (!this.stripe || !this.cardElement) {
      return { success: false, error: 'Payment system not initialized' };
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      const { error, paymentIntent } = await this.stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: this.cardElement,
        },
      });

      if (error) {
        console.error('Payment error:', error);
        this._error.set(error.message || 'Payment failed');
        return { success: false, error: error.message };
      }

      if (paymentIntent?.status === 'succeeded') {
        return { success: true, paymentIntentId: paymentIntent.id };
      }

      return { success: false, error: 'Payment was not successful' };
    } catch (err) {
      console.error('Error confirming payment:', err);
      const message = err instanceof Error ? err.message : 'Payment failed';
      this._error.set(message);
      return { success: false, error: message };
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Clean up card element
   */
  cleanup(): void {
    if (this.cardElement) {
      this.cardElement.unmount();
      this.cardElement = null;
    }
    this.elements = null;
  }
}
