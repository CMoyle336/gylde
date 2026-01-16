import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
export class SettingsComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly translateService = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly functions = inject(Functions);
  private readonly dialog = inject(MatDialog);
  protected readonly themeService = inject(ThemeService);
  protected readonly subscriptionService = inject(SubscriptionService);

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

  ngOnInit(): void {
    this.loadSettings();
    // Sync email verification status after a short delay to avoid race conditions
    // and only if the user has an email but it's not yet verified in Firestore
    setTimeout(() => this.syncEmailVerificationStatus(), 500);
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

  protected goToSubscription(): void {
    this.router.navigate(['/subscription']);
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
          pushEnabled: false,
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

    // Handle language change
    if (category === 'preferences' && key === 'language') {
      this.translateService.use(value as string);
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
    this.phoneVerificationStep.set('input');
    this.authService.cleanupRecaptcha();
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
    } catch (error) {
      console.error('Error enabling account:', error);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteAccount(): Promise<void> {
    if (this.deleteConfirmation !== 'DELETE') {
      this.dialogError.set('Please type DELETE to confirm');
      return;
    }

    if (!this.currentPassword) {
      this.dialogError.set('Please enter your password');
      return;
    }

    this.dialogLoading.set(true);
    this.dialogError.set(null);

    try {
      // Mark account for deletion
      const currentSettings = this.settings();
      const updatedSettings: UserSettings = {
        ...currentSettings,
        account: {
          ...currentSettings.account,
          scheduledForDeletion: true,
          deletionScheduledAt: new Date(),
        },
      };

      await this.saveSettings(updatedSettings);
      
      // Sign out and redirect
      await this.authService.signOutUser();
      this.router.navigate(['/']);
    } catch (error) {
      this.dialogError.set('Failed to delete account. Please try again.');
      this.dialogLoading.set(false);
    }
  }

  // Logout
  openLogoutDialog(): void {
    this.showLogoutDialog.set(true);
  }

  async confirmLogout(): Promise<void> {
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
    
    // Initialize reCAPTCHA after dialog opens
    setTimeout(() => {
      this.authService.initRecaptcha('send-code-btn');
    }, 100);
  }

  async sendVerificationCode(): Promise<void> {
    if (!this.phoneNumber) {
      this.dialogError.set('Please enter your phone number');
      return;
    }

    // Ensure phone number starts with + for E.164 format
    let formattedPhone = this.phoneNumber.trim();
    if (!formattedPhone.startsWith('+')) {
      this.dialogError.set('Please include your country code (e.g., +1 for US)');
      return;
    }

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
    } catch (error: any) {
      console.error('Failed to verify code:', error);
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
    this.dialogError.set(null);
    
    // Re-initialize reCAPTCHA and send code again
    this.authService.cleanupRecaptcha();
    this.phoneVerificationStep.set('input');
    
    setTimeout(() => {
      this.authService.initRecaptcha('send-code-btn');
    }, 100);
  }
}
