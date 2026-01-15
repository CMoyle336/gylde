import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ThemeService } from '../../core/services/theme.service';
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

  // User info
  protected readonly userEmail = computed(() => this.authService.user()?.email || null);
  
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
  protected readonly dialogLoading = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly dialogSuccess = signal<string | null>(null);

  // Dialog form values
  protected newEmail = '';
  protected currentPassword = '';
  protected deleteConfirmation = '';

  ngOnInit(): void {
    this.loadSettings();
  }

  protected openBlockedUsersDialog(): void {
    this.dialog.open(BlockedUsersDialogComponent, {
      panelClass: 'blocked-users-dialog-container',
    });
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
    this.dialogLoading.set(false);
    this.dialogError.set(null);
    this.dialogSuccess.set(null);
    this.newEmail = '';
    this.currentPassword = '';
    this.deleteConfirmation = '';
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
}
