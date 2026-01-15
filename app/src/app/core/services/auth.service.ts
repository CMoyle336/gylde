import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  RecaptchaVerifier,
  PhoneAuthProvider,
  linkWithCredential,
  ConfirmationResult,
} from '@angular/fire/auth';
import { AuthUser } from '../interfaces';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  private readonly _user = signal<AuthUser | null>(null);
  private readonly _loading = signal(true);
  private readonly _error = signal<string | null>(null);
  
  // Promise that resolves when auth state is first determined
  private authReadyPromise: Promise<void>;
  private authReadyResolve!: () => void;
  
  // Phone auth state
  private recaptchaVerifier: RecaptchaVerifier | null = null;
  private confirmationResult: ConfirmationResult | null = null;
  private pendingPhoneNumber: string | null = null;
  private readonly isEmulator = environment.useEmulators;

  readonly user = this._user.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  constructor() {
    this.authReadyPromise = new Promise((resolve) => {
      this.authReadyResolve = resolve;
    });
    this.initAuthListener();
    
    // In emulator mode, disable app verification for phone auth testing
    if (this.isEmulator) {
      // @ts-ignore - Firebase internal property for testing
      this.auth.settings.appVerificationDisabledForTesting = true;
    }
  }

  /**
   * Wait for auth state to be initialized (use in guards)
   */
  waitForAuthReady(): Promise<void> {
    return this.authReadyPromise;
  }

  private initAuthListener(): void {
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this._user.set(this.mapUser(user));
      } else {
        this._user.set(null);
      }
      this._loading.set(false);
      this.authReadyResolve();
    });
  }

  private mapUser(user: User): AuthUser {
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified,
    };
  }

  async signUp(email: string, password: string, displayName?: string): Promise<void> {
    try {
      this._error.set(null);
      this._loading.set(true);
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);

      if (displayName && credential.user) {
        await updateProfile(credential.user, { displayName });
      }

      this._user.set(this.mapUser(credential.user));
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    try {
      this._error.set(null);
      this._loading.set(true);
      const credential = await signInWithEmailAndPassword(this.auth, email, password);
      this._user.set(this.mapUser(credential.user));
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    try {
      this._error.set(null);
      this._loading.set(true);
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(this.auth, provider);
      this._user.set(this.mapUser(credential.user));
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  async signOutUser(): Promise<void> {
    try {
      this._error.set(null);
      await signOut(this.auth);
      this._user.set(null);
      this.router.navigate(['/']);
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    }
  }

  async resetPassword(email: string): Promise<void> {
    try {
      this._error.set(null);
      await sendPasswordResetEmail(this.auth, email);
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Send email verification to the current user
   * @returns true if email was sent successfully
   */
  async sendEmailVerification(): Promise<boolean> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    if (currentUser.emailVerified) {
      throw new Error('Email is already verified');
    }

    try {
      this._error.set(null);
      const { sendEmailVerification } = await import('@angular/fire/auth');
      await sendEmailVerification(currentUser);
      return true;
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Check if the current user's email is verified
   * Refreshes the user to get the latest state
   */
  async checkEmailVerified(): Promise<boolean> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      return false;
    }

    await currentUser.reload();
    this._user.set(this.mapUser(currentUser));
    return currentUser.emailVerified;
  }

  /**
   * Get if the current user's email is verified (from cached state)
   */
  isEmailVerified(): boolean {
    return this._user()?.emailVerified ?? false;
  }

  /**
   * Change user's email address
   * Requires re-authentication and sends verification to new email
   */
  async changeEmail(newEmail: string, currentPassword: string): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser || !currentUser.email) {
      throw new Error('No authenticated user');
    }

    try {
      this._error.set(null);

      // Re-authenticate user with current password
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);

      // Send verification email to new address
      // When user clicks the link, their email will be updated
      await verifyBeforeUpdateEmail(currentUser, newEmail);
    } catch (error) {
      this._error.set(this.getErrorMessage(error));
      throw error;
    }
  }

  async updateUserPhoto(photoURL: string): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    await updateProfile(currentUser, { photoURL });
    // Update local user signal
    this._user.set(this.mapUser(currentUser));
  }

  /**
   * Initialize reCAPTCHA verifier for phone auth
   * Must be called before sending verification code
   * Note: In emulator mode, reCAPTCHA is not required
   */
  initRecaptcha(buttonId: string): void {
    // Skip reCAPTCHA in emulator mode
    if (this.isEmulator) {
      console.log('[Auth] Emulator mode: skipping reCAPTCHA initialization');
      return;
    }
    
    if (this.recaptchaVerifier) {
      this.recaptchaVerifier.clear();
    }
    
    this.recaptchaVerifier = new RecaptchaVerifier(this.auth, buttonId, {
      size: 'invisible',
      callback: () => {
        // reCAPTCHA solved - allow sending verification code
      },
      'expired-callback': () => {
        // Reset reCAPTCHA if expired
        this.recaptchaVerifier?.clear();
        this.recaptchaVerifier = null;
      },
    });
  }

  /**
   * Send SMS verification code to phone number
   * @param phoneNumber Phone number in E.164 format (e.g., +1234567890)
   * @returns true if code was sent successfully
   */
  async sendPhoneVerificationCode(phoneNumber: string): Promise<boolean> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    try {
      this._error.set(null);
      this.pendingPhoneNumber = phoneNumber;
      
      const provider = new PhoneAuthProvider(this.auth);
      let verificationId: string;
      
      // In emulator mode with appVerificationDisabledForTesting, create a temp verifier
      if (this.isEmulator) {
        // Create a temporary invisible RecaptchaVerifier for emulator
        const tempVerifier = new RecaptchaVerifier(this.auth, 'send-code-btn', {
          size: 'invisible',
        });
        
        try {
          verificationId = await provider.verifyPhoneNumber(phoneNumber, tempVerifier);
        } finally {
          tempVerifier.clear();
        }
      } else {
        // Production mode: use reCAPTCHA and actual SMS
        if (!this.recaptchaVerifier) {
          throw new Error('reCAPTCHA not initialized. Call initRecaptcha first.');
        }
        
        verificationId = await provider.verifyPhoneNumber(phoneNumber, this.recaptchaVerifier);
      }
      
      // Store for later use in confirmPhoneVerification
      this.confirmationResult = {
        verificationId,
        confirm: async (code: string) => {
          const credential = PhoneAuthProvider.credential(verificationId, code);
          return await linkWithCredential(currentUser, credential);
        },
      } as ConfirmationResult;
      
      return true;
    } catch (error) {
      this._error.set(this.getPhoneErrorMessage(error));
      throw error;
    }
  }

  /**
   * Verify the SMS code and link phone to user account
   * @param code 6-digit verification code from SMS
   * @returns true if verification successful
   */
  async confirmPhoneVerification(code: string): Promise<boolean> {
    if (!this.confirmationResult) {
      throw new Error('No verification in progress. Send code first.');
    }

    try {
      this._error.set(null);
      await this.confirmationResult.confirm(code);
      
      // Refresh user to get updated phone number
      const currentUser = this.auth.currentUser;
      if (currentUser) {
        await currentUser.reload();
        this._user.set(this.mapUser(currentUser));
      }
      
      // Clean up
      this.confirmationResult = null;
      
      return true;
    } catch (error) {
      this._error.set(this.getPhoneErrorMessage(error));
      throw error;
    }
  }

  /**
   * Clean up reCAPTCHA verifier
   */
  cleanupRecaptcha(): void {
    if (this.recaptchaVerifier) {
      this.recaptchaVerifier.clear();
      this.recaptchaVerifier = null;
    }
    this.confirmationResult = null;
    this.pendingPhoneNumber = null;
  }

  /**
   * Get current user's verified phone number from Firebase Auth
   * In emulator mode, this may return null even after verification
   */
  getPhoneNumber(): string | null {
    return this.auth.currentUser?.phoneNumber || null;
  }
  
  /**
   * Get the pending phone number being verified (for emulator mode)
   */
  getPendingPhoneNumber(): string | null {
    return this.pendingPhoneNumber;
  }
  
  /**
   * Check if running in emulator mode
   */
  isUsingEmulator(): boolean {
    return this.isEmulator;
  }

  /**
   * Send SMS verification code for phone sign-in (not linking)
   * @param phoneNumber Phone number in E.164 format (e.g., +1234567890)
   * @returns true if code was sent successfully
   */
  async sendPhoneSignInCode(phoneNumber: string): Promise<boolean> {
    try {
      this._error.set(null);
      this.pendingPhoneNumber = phoneNumber;
      
      const { signInWithPhoneNumber } = await import('@angular/fire/auth');
      
      // In emulator mode with appVerificationDisabledForTesting, we still need a verifier
      // but it will be bypassed. Create a temporary one if not already initialized.
      if (this.isEmulator) {
        // Create a temporary invisible RecaptchaVerifier for emulator
        // It won't actually verify due to appVerificationDisabledForTesting
        const tempVerifier = new RecaptchaVerifier(this.auth, 'phone-signin-btn', {
          size: 'invisible',
        });
        
        try {
          this.confirmationResult = await signInWithPhoneNumber(this.auth, phoneNumber, tempVerifier);
        } finally {
          tempVerifier.clear();
        }
        return true;
      }
      
      // Production mode: use reCAPTCHA and actual SMS
      if (!this.recaptchaVerifier) {
        throw new Error('reCAPTCHA not initialized. Call initRecaptcha first.');
      }
      
      this.confirmationResult = await signInWithPhoneNumber(this.auth, phoneNumber, this.recaptchaVerifier);
      
      return true;
    } catch (error) {
      this._error.set(this.getPhoneErrorMessage(error));
      throw error;
    }
  }

  /**
   * Verify the SMS code and sign in with phone
   * @param code 6-digit verification code from SMS
   * @returns The user if sign-in successful
   */
  async confirmPhoneSignIn(code: string): Promise<AuthUser | null> {
    if (!this.confirmationResult) {
      throw new Error('No verification in progress. Send code first.');
    }

    try {
      this._error.set(null);
      
      // Use the real Firebase confirmation result (works in both emulator and production)
      const result = await this.confirmationResult.confirm(code);
      
      if (result.user) {
        await result.user.reload();
        const mappedUser = this.mapUser(result.user);
        this._user.set(mappedUser);
        this.confirmationResult = null;
        return mappedUser;
      }
      
      this.confirmationResult = null;
      return null;
    } catch (error) {
      this._error.set(this.getPhoneErrorMessage(error));
      throw error;
    }
  }

  clearError(): void {
    this._error.set(null);
  }

  private getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      switch (code) {
        case 'auth/email-already-in-use':
          return 'This email is already registered.';
        case 'auth/invalid-email':
          return 'Invalid email address.';
        case 'auth/operation-not-allowed':
          return 'This sign-in method is not enabled.';
        case 'auth/weak-password':
          return 'Password is too weak. Use at least 6 characters.';
        case 'auth/user-disabled':
          return 'This account has been disabled.';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          return 'Invalid email or password.';
        case 'auth/too-many-requests':
          return 'Too many attempts. Please try again later.';
        case 'auth/popup-closed-by-user':
          return 'Sign-in was cancelled.';
        default:
          return 'An error occurred. Please try again.';
      }
    }
    return 'An unexpected error occurred.';
  }

  private getPhoneErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      switch (code) {
        case 'auth/invalid-phone-number':
          return 'Please enter a valid phone number with country code (e.g., +1 555 123 4567).';
        case 'auth/missing-phone-number':
          return 'Please enter your phone number.';
        case 'auth/quota-exceeded':
          return 'SMS quota exceeded. Please try again later.';
        case 'auth/user-disabled':
          return 'This account has been disabled.';
        case 'auth/captcha-check-failed':
          return 'reCAPTCHA verification failed. Please refresh and try again.';
        case 'auth/invalid-verification-code':
          return 'Invalid verification code. Please check and try again.';
        case 'auth/code-expired':
          return 'Verification code expired. Please request a new code.';
        case 'auth/credential-already-in-use':
          return 'This phone number is already linked to another account.';
        case 'auth/provider-already-linked':
          return 'A phone number is already linked to this account.';
        case 'auth/too-many-requests':
          return 'Too many attempts. Please try again later.';
        default:
          return 'Failed to verify phone number. Please try again.';
      }
    }
    return 'An unexpected error occurred.';
  }
}
