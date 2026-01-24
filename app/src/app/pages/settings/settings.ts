import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, computed, inject, signal, effect, ElementRef, viewChild, viewChildren } from '@angular/core';
import intlTelInput, { Iti } from 'intl-tel-input';
import { FormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ThemeService } from '../../core/services/theme.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { UserSettings } from '../../core/interfaces';
import { BlockedUsersDialogComponent } from '../../components/blocked-users-dialog';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslateModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly translateService = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly functions = inject(Functions);
  private readonly dialog = inject(MatDialog);
  protected readonly themeService = inject(ThemeService);
  protected readonly subscriptionService = inject(SubscriptionService);
  private readonly analytics = inject(AnalyticsService);

  // User info
  protected readonly userEmail = computed(() => this.authService.user()?.email || null);
  protected readonly isEmailVerified = computed(() => this.authService.user()?.emailVerified ?? false);
  
  // Theme
  protected readonly isDarkMode = computed(() => this.themeService.theme() === 'dark');

  // Settings state
  protected readonly settings = signal<UserSettings>({});
  protected readonly saving = signal(false);

  // Account status
  protected readonly isAccountDisabled = computed(() => 
    this.settings().account?.disabled ?? false
  );

  // Dialog states
  protected readonly showChangeEmailDialog = signal(false);
  protected readonly showResetPasswordDialog = signal(false);
  protected readonly showDeleteAccountDialog = signal(false);
  protected readonly showDisableAccountDialog = signal(false);
  protected readonly showLogoutDialog = signal(false);
  protected readonly showPhoneDialog = signal(false);
  protected readonly showVerifyEmailDialog = signal(false);
  protected readonly dialogLoading = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly dialogSuccess = signal<string | null>(null);

  // Phone verification state
  protected readonly phoneVerificationStep = signal<'input' | 'verify' | 'success'>('input');
  protected readonly userPhoneNumber = computed(() => {
    // Check Firebase Auth first, then fall back to profile (for emulator mode)
    const authPhone = this.authService.getPhoneNumber();
    if (authPhone) return authPhone;
    
    const profile = this.userProfileService.profile();
    return profile?.phoneNumber || null;
  });
  protected readonly isEmulator = this.authService.isUsingEmulator();

  // Dialog form values
  protected newEmail = '';
  protected currentPassword = '';
  protected deleteConfirmation = '';
  protected phoneNumber = '';
  protected verificationCode = '';

  // Phone input with intl-tel-input
  private readonly phoneInputRef = viewChild<ElementRef<HTMLInputElement>>('phoneInput');
  private intlTelInputInstance: Iti | null = null;

  // 6-digit verification code inputs
  private readonly codeInputRefs = viewChildren<ElementRef<HTMLInputElement>>('codeInput');
  protected readonly codeDigits = signal<string[]>(['', '', '', '', '', '']);

  constructor() {
    // Initialize intl-tel-input when phone dialog is shown and input is available
    effect(() => {
      const isOpen = this.showPhoneDialog();
      const inputRef = this.phoneInputRef();
      
      if (isOpen && inputRef?.nativeElement && !this.intlTelInputInstance) {
        // Small delay to ensure DOM is ready
        setTimeout(() => this.initPhoneInput(), 50);
      }
    });

    // Auto-focus first digit input when verification step starts
    effect(() => {
      const step = this.phoneVerificationStep();
      if (step === 'verify') {
        // Small delay to ensure DOM is ready
        setTimeout(() => this.focusDigitInput(0), 100);
      }
    });
  }

  ngOnInit(): void {
    this.loadSettings();
    // Sync email verification status after a short delay to avoid race conditions
    // and only if the user has an email but it's not yet verified in Firestore
    setTimeout(() => this.syncEmailVerificationStatus(), 500);
  }

  ngOnDestroy(): void {
    this.destroyPhoneInput();
  }

  private initPhoneInput(): void {
    const inputRef = this.phoneInputRef();
    if (!inputRef?.nativeElement || this.intlTelInputInstance) return;

    this.intlTelInputInstance = intlTelInput(inputRef.nativeElement, {
      initialCountry: 'us',
      separateDialCode: true,
      formatAsYouType: true,
      nationalMode: false,
      autoPlaceholder: 'aggressive',
      strictMode: true, // Only allow numeric characters, cap at max valid length
      loadUtils: () => import('intl-tel-input/utils'),
    });

    // Auto-focus the input after initialization
    setTimeout(() => {
      inputRef.nativeElement.focus();
    }, 100);
  }

  // Handle Enter key on phone input to submit
  protected onPhoneInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !this.dialogLoading()) {
      event.preventDefault();
      this.sendVerificationCode();
    }
  }

  private destroyPhoneInput(): void {
    if (this.intlTelInputInstance) {
      this.intlTelInputInstance.destroy();
      this.intlTelInputInstance = null;
    }
  }

  /**
   * Sync email verification status from Firebase Auth to Firestore
   * This ensures the trust score is recalculated when email is verified
   */
  private async syncEmailVerificationStatus(): Promise<void> {
    try {
      const profile = this.userProfileService.profile();
      
      // Skip if no profile or already verified in Firestore
      if (!profile || profile.emailVerified === true) {
        return;
      }
      
      // Skip if no email
      if (!this.userEmail()) {
        return;
      }
      
      // Check Firebase Auth status (this refreshes the user)
      const isVerified = await this.authService.checkEmailVerified();
      
      // If Firebase Auth says verified but Firestore doesn't have it, update Firestore
      if (isVerified) {
        await this.userProfileService.updateProfile({
          emailVerified: true,
        });
        console.log('[Settings] Synced email verification status to Firestore');
      }
    } catch (error) {
      // Silently ignore errors - this is a background sync
      console.debug('[Settings] Email verification sync skipped:', error);
    }
  }

  protected openBlockedUsersDialog(): void {
    this.dialog.open(BlockedUsersDialogComponent, {
      panelClass: 'blocked-users-dialog-container',
    });
  }

  protected async handleSubscriptionAction(): Promise<void> {
    if (this.subscriptionService.isPremium()) {
      // Open Stripe customer portal for managing subscription
      this.saving.set(true);
      try {
        const createPortal = httpsCallable<void, { url: string }>(
          this.functions, 
          'createCustomerPortal'
        );
        const result = await createPortal();
        if (result.data.url) {
          window.location.href = result.data.url;
        }
      } catch (err) {
        console.error('Error creating customer portal:', err);
      } finally {
        this.saving.set(false);
      }
    } else {
      // Show upgrade dialog for free users
      await this.subscriptionService.showUpgradePrompt();
    }
  }

  private loadSettings(): void {
    const profile = this.userProfileService.profile();
    if (profile?.settings) {
      this.settings.set({ ...profile.settings });
    } else {
      // Set default settings
      this.settings.set({
        activity: {
          createOnView: true,
          createOnFavorite: true,
          createOnMessage: true,
        },
        privacy: {
          showOnlineStatus: true,
          showLastActive: true,
          profileVisible: true,
          showLocation: true,
        },
        notifications: {
          emailMatches: true,
          emailMessages: true,
          emailFavorites: true,
        },
        preferences: {
          language: this.translateService.currentLang || 'en',
          theme: 'dark',
        },
        account: {
          disabled: false,
        },
      });
    }
  }

  async updateSetting(
    category: keyof UserSettings,
    key: string,
    value: boolean | string
  ): Promise<void> {
    const currentSettings = this.settings();
    const categorySettings = currentSettings[category] || {};
    
    const updatedSettings: UserSettings = {
      ...currentSettings,
      [category]: {
        ...categorySettings,
        [key]: value,
      },
    };

    this.settings.set(updatedSettings);
    await this.saveSettings(updatedSettings);

    // Track setting changed
    this.analytics.trackSettingChanged(category, key, value);

    // Handle language change
    if (category === 'preferences' && key === 'language') {
      this.analytics.trackLanguageChanged(value as string);
      this.translateService.use(value as string);
    }
    
    // Handle theme change tracking
    if (category === 'preferences' && key === 'theme') {
      this.analytics.trackThemeChanged(value as 'light' | 'dark');
    }
  }

  private async saveSettings(settings: UserSettings): Promise<void> {
    this.saving.set(true);
    try {
      await this.userProfileService.updateProfile({ settings });
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      this.saving.set(false);
    }
  }

  // Dialog handlers
  openChangeEmail(): void {
    this.newEmail = '';
    this.currentPassword = '';
    this.dialogError.set(null);
    this.dialogSuccess.set(null);
    this.showChangeEmailDialog.set(true);
  }

  openResetPassword(): void {
    this.dialogError.set(null);
    this.dialogSuccess.set(null);
    this.showResetPasswordDialog.set(true);
  }

  openVerifyEmail(): void {
    this.dialogError.set(null);
    this.dialogSuccess.set(null);
    this.showVerifyEmailDialog.set(true);
  }

  async sendEmailVerification(): Promise<void> {
    this.dialogLoading.set(true);
    this.dialogError.set(null);
    this.dialogSuccess.set(null);

    try {
      await this.authService.sendEmailVerification();
      this.dialogSuccess.set(this.translateService.instant('SETTINGS.DIALOGS.VERIFY_EMAIL_SENT'));
      this.analytics.trackEmailVerificationSent();
    } catch (error: any) {
      console.error('Failed to send verification email:', error);
      if (error?.code === 'auth/too-many-requests') {
        this.dialogError.set(this.translateService.instant('SETTINGS.DIALOGS.TOO_MANY_REQUESTS'));
      } else {
        const authError = this.authService.error();
        this.dialogError.set(authError || error?.message || 'Failed to send verification email.');
      }
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async checkEmailVerification(): Promise<void> {
    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      const verified = await this.authService.checkEmailVerified();
      if (verified) {
        this.dialogSuccess.set(this.translateService.instant('SETTINGS.DIALOGS.EMAIL_VERIFIED_SUCCESS'));
      } else {
        this.dialogError.set(this.translateService.instant('SETTINGS.DIALOGS.EMAIL_NOT_YET_VERIFIED'));
      }
    } catch (error: any) {
      console.error('Failed to check email verification:', error);
      this.dialogError.set('Failed to check verification status.');
    } finally {
      this.dialogLoading.set(false);
    }
  }

  openDeleteAccount(): void {
    this.deleteConfirmation = '';
    this.currentPassword = '';
    this.dialogError.set(null);
    this.showDeleteAccountDialog.set(true);
  }

  closeDialogs(): void {
    this.showChangeEmailDialog.set(false);
    this.showResetPasswordDialog.set(false);
    this.showDeleteAccountDialog.set(false);
    this.showDisableAccountDialog.set(false);
    this.showLogoutDialog.set(false);
    this.showPhoneDialog.set(false);
    this.showVerifyEmailDialog.set(false);
    this.dialogLoading.set(false);
    this.dialogError.set(null);
    this.dialogSuccess.set(null);
    this.newEmail = '';
    this.currentPassword = '';
    this.deleteConfirmation = '';
    this.phoneNumber = '';
    this.verificationCode = '';
    this.codeDigits.set(['', '', '', '', '', '']);
    this.phoneVerificationStep.set('input');
    this.authService.cleanupRecaptcha();
    this.destroyPhoneInput();
  }

  openDisableAccount(): void {
    this.dialogError.set(null);
    this.showDisableAccountDialog.set(true);
  }

  async changeEmail(): Promise<void> {
    if (!this.newEmail || !this.currentPassword) {
      this.dialogError.set('Please fill in all fields');
      return;
    }

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      await this.authService.changeEmail(this.newEmail, this.currentPassword);
      this.dialogSuccess.set('Verification email sent to your new address. Please check your inbox and click the link to confirm the change.');
      this.newEmail = '';
      this.currentPassword = '';
    } catch (error: unknown) {
      // Handle specific Firebase errors
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code: string }).code;
        switch (code) {
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            this.dialogError.set('Incorrect password. Please try again.');
            break;
          case 'auth/email-already-in-use':
            this.dialogError.set('This email is already in use by another account.');
            break;
          case 'auth/invalid-email':
            this.dialogError.set('Please enter a valid email address.');
            break;
          case 'auth/requires-recent-login':
            this.dialogError.set('Please sign out and sign back in, then try again.');
            break;
          default:
            this.dialogError.set('Failed to change email. Please try again.');
        }
      } else {
        this.dialogError.set('Failed to change email. Please try again.');
      }
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async sendPasswordReset(): Promise<void> {
    const email = this.userEmail();
    if (!email) {
      this.dialogError.set('No email address found');
      return;
    }

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      await this.authService.resetPassword(email);
      this.dialogSuccess.set('Password reset email sent! Check your inbox.');
    } catch (error) {
      this.dialogError.set('Failed to send reset email. Please try again.');
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async disableAccount(): Promise<void> {
    // This is called from the button - open the confirmation dialog
    this.openDisableAccount();
  }

  async confirmDisableAccount(): Promise<void> {
    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      // Call Cloud Function to disable both Auth and Firestore
      const disableAccountFn = httpsCallable(this.functions, 'disableAccount');
      await disableAccountFn({});

      // Update local state
      const currentSettings = this.settings();
      const updatedSettings: UserSettings = {
        ...currentSettings,
        account: {
          ...currentSettings.account,
          disabled: true,
          disabledAt: new Date(),
        },
      };
      this.settings.set(updatedSettings);

      this.analytics.trackAccountDisabled();
      
      // Close dialog and sign out
      this.closeDialogs();
      await this.authService.signOutUser();
      this.router.navigate(['/']);
    } catch (error) {
      console.error('Error disabling account:', error);
      this.dialogError.set('Failed to disable account. Please try again.');
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async enableAccount(): Promise<void> {
    this.saving.set(true);
    try {
      // Call Cloud Function to enable both Auth and Firestore
      const enableAccountFn = httpsCallable(this.functions, 'enableAccount');
      await enableAccountFn({});

      // Update local state
      const currentSettings = this.settings();
      const updatedSettings: UserSettings = {
        ...currentSettings,
        account: {
          ...currentSettings.account,
          disabled: false,
          disabledAt: undefined,
        },
      };
      this.settings.set(updatedSettings);
      this.analytics.trackAccountEnabled();
    } catch (error) {
      console.error('Error enabling account:', error);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteAccount(): Promise<void> {
    const expectedConfirmation = 'DELETE MY ACCOUNT';
    if (this.deleteConfirmation !== expectedConfirmation) {
      this.dialogError.set(`Please type "${expectedConfirmation}" exactly to confirm`);
      return;
    }

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      // Call Cloud Function to permanently delete all user data
      const deleteAccountFn = httpsCallable(this.functions, 'deleteAccount');
      await deleteAccountFn({});
      
      this.analytics.trackAccountDeleted();
      
      // Close dialog, sign out, and redirect to home
      this.closeDialogs();
      await this.authService.signOutUser();
      this.router.navigate(['/']);
    } catch (error: unknown) {
      console.error('Error deleting account:', error);
      
      // Handle specific errors
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code: string }).code;
        if (code === 'functions/unauthenticated') {
          this.dialogError.set('Session expired. Please sign in again and try.');
        } else {
          this.dialogError.set('Failed to delete account. Please try again or contact support.');
        }
      } else {
        this.dialogError.set('Failed to delete account. Please try again or contact support.');
      }
      this.dialogLoading.set(false);
    }
  }

  // Logout
  openLogoutDialog(): void {
    this.showLogoutDialog.set(true);
  }

  async confirmLogout(): Promise<void> {
    this.analytics.trackLogout();
    await this.authService.signOutUser();
    this.router.navigate(['/']);
  }

  // Phone verification
  openPhoneDialog(): void {
    this.phoneNumber = '';
    this.verificationCode = '';
    this.phoneVerificationStep.set('input');
    this.dialogError.set(null);
    this.showPhoneDialog.set(true);
    this.analytics.trackPhoneVerificationStarted();
    
    // Initialize reCAPTCHA after dialog opens
    setTimeout(() => {
      this.authService.initRecaptcha('send-code-btn');
    }, 100);
  }

  async sendVerificationCode(): Promise<void> {
    // Get the formatted E.164 number from intl-tel-input
    let formattedPhone: string;
    
    if (this.intlTelInputInstance) {
      // Validate using intl-tel-input
      if (!this.intlTelInputInstance.isValidNumber()) {
        this.dialogError.set('Please enter a valid phone number');
        return;
      }
      formattedPhone = this.intlTelInputInstance.getNumber();
    } else {
      // Fallback to manual validation
      if (!this.phoneNumber) {
        this.dialogError.set('Please enter your phone number');
        return;
      }
      formattedPhone = this.phoneNumber.trim();
      if (!formattedPhone.startsWith('+')) {
        this.dialogError.set('Please include your country code (e.g., +1 for US)');
        return;
      }
    }

    // Store the formatted number for display
    this.phoneNumber = formattedPhone;

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      await this.authService.sendPhoneVerificationCode(formattedPhone);
      this.phoneVerificationStep.set('verify');
    } catch (error: any) {
      console.error('Failed to send verification code:', error);
      // Display the error from auth service, or extract from Firebase error
      const authError = this.authService.error();
      if (authError) {
        this.dialogError.set(authError);
      } else {
        this.dialogError.set(error?.message || 'Failed to send verification code. Please try again.');
      }
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async confirmVerificationCode(): Promise<void> {
    if (!this.verificationCode.trim()) {
      this.dialogError.set('Please enter the verification code');
      return;
    }
    
    if (this.verificationCode.length !== 6) {
      this.dialogError.set('Please enter the 6-digit code');
      return;
    }

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      await this.authService.confirmPhoneVerification(this.verificationCode);
      
      // Update user profile with verified phone number
      // In emulator mode, use the pending phone number since Firebase Auth won't be updated
      const phoneNumber = this.authService.getPhoneNumber() || 
                          (this.isEmulator ? this.authService.getPendingPhoneNumber() : null);
      
      if (phoneNumber) {
        await this.userProfileService.updateProfile({
          phoneNumber,
          phoneNumberVerified: true,
        });
      }
      
      this.phoneVerificationStep.set('success');
      this.analytics.trackPhoneVerificationCompleted(true);
    } catch (error: any) {
      console.error('Failed to verify code:', error);
      this.analytics.trackPhoneVerificationCompleted(false);
      // Handle specific Firebase error codes
      if (error?.code === 'auth/invalid-verification-code') {
        this.dialogError.set('Invalid verification code. Please try again.');
      } else if (error?.code === 'auth/account-exists-with-different-credential') {
        this.dialogError.set('This phone number is already linked to another account.');
      } else if (error?.code === 'auth/credential-already-in-use') {
        this.dialogError.set('This phone number is already in use by another account.');
      } else {
        // Display the error from auth service, or extract from Firebase error
        const authError = this.authService.error();
        this.dialogError.set(authError || error?.message || 'Failed to verify code. Please try again.');
      }
    } finally {
      this.dialogLoading.set(false);
    }
  }

  async resendCode(): Promise<void> {
    this.verificationCode = '';
    this.resetCodeDigits();
    this.dialogError.set(null);
    
    // Re-initialize reCAPTCHA and send code again
    this.authService.cleanupRecaptcha();
    this.phoneVerificationStep.set('input');
    
    setTimeout(() => {
      this.authService.initRecaptcha('send-code-btn');
    }, 100);
  }

  // ============================================
  // 6-DIGIT VERIFICATION CODE INPUT HANDLING
  // ============================================

  private resetCodeDigits(): void {
    this.codeDigits.set(['', '', '', '', '', '']);
  }

  protected onDigitInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    
    // Only allow single digit
    const digit = value.replace(/\D/g, '').slice(-1);
    
    // Update the digit at this index
    const digits = [...this.codeDigits()];
    digits[index] = digit;
    this.codeDigits.set(digits);
    
    // Update input value (in case non-numeric was entered)
    input.value = digit;
    
    // Move to next input if digit was entered
    if (digit && index < 5) {
      this.focusDigitInput(index + 1);
    }
    
    // Check if all digits are entered and auto-submit
    if (digits.every(d => d !== '') && digits.length === 6) {
      this.verificationCode = digits.join('');
      this.confirmVerificationCode();
    }
  }

  protected onDigitKeydown(event: KeyboardEvent, index: number): void {
    const input = event.target as HTMLInputElement;
    
    if (event.key === 'Backspace') {
      const digits = [...this.codeDigits()];
      
      if (digits[index] === '' && index > 0) {
        // Current input is empty, move to previous and clear it
        event.preventDefault();
        digits[index - 1] = '';
        this.codeDigits.set(digits);
        this.focusDigitInput(index - 1);
      } else {
        // Clear current input
        digits[index] = '';
        this.codeDigits.set(digits);
        input.value = '';
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusDigitInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault();
      this.focusDigitInput(index + 1);
    } else if (event.key >= '0' && event.key <= '9') {
      // If there's already a value, replace it and move to next
      if (this.codeDigits()[index] !== '') {
        event.preventDefault();
        const digits = [...this.codeDigits()];
        digits[index] = event.key;
        this.codeDigits.set(digits);
        input.value = event.key;
        
        if (index < 5) {
          this.focusDigitInput(index + 1);
        }
        
        // Check if all digits are entered and auto-submit
        if (digits.every(d => d !== '') && digits.length === 6) {
          this.verificationCode = digits.join('');
          this.confirmVerificationCode();
        }
      }
    }
  }

  protected onCodePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text') || '';
    const digits = pastedData.replace(/\D/g, '').slice(0, 6).split('');
    
    // Pad with empty strings if less than 6 digits
    while (digits.length < 6) {
      digits.push('');
    }
    
    this.codeDigits.set(digits);
    
    // Update all input values
    const inputs = this.codeInputRefs();
    inputs.forEach((inputRef, i) => {
      inputRef.nativeElement.value = digits[i];
    });
    
    // Focus the appropriate input
    const nextEmptyIndex = digits.findIndex(d => d === '');
    if (nextEmptyIndex !== -1) {
      this.focusDigitInput(nextEmptyIndex);
    } else {
      // All filled, auto-submit
      this.verificationCode = digits.join('');
      this.confirmVerificationCode();
    }
  }

  protected onDigitFocus(index: number): void {
    // Select the content when focused
    const inputs = this.codeInputRefs();
    if (inputs[index]) {
      inputs[index].nativeElement.select();
    }
  }

  private focusDigitInput(index: number): void {
    const inputs = this.codeInputRefs();
    if (inputs[index]) {
      inputs[index].nativeElement.focus();
    }
  }
}
