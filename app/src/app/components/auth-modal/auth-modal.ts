import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  output,
  input,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { AuthResult, UserProfile } from '../../core/interfaces';

type AuthMode = 'login' | 'signup' | 'reset' | 'disabled';
type LoginMethod = 'email' | 'phone';

@Component({
  selector: 'app-auth-modal',
  templateUrl: './auth-modal.html',
  styleUrl: './auth-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class AuthModalComponent {
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly functions = inject(Functions);

  readonly isOpen = input.required<boolean>();
  readonly initialMode = input<AuthMode>('login');
  readonly closed = output<void>();
  readonly authenticated = output<AuthResult>();

  protected readonly mode = signal<AuthMode>('login');
  protected readonly loginMethod = signal<LoginMethod>('email');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly displayName = signal('');
  protected readonly phoneNumber = signal('');
  protected readonly verificationCode = signal('');
  protected readonly phoneStep = signal<'input' | 'verify'>('input');
  protected readonly submitting = signal(false);
  protected readonly localError = signal<string | null>(null);
  protected readonly resetSent = signal(false);
  protected readonly enablingAccount = signal(false);
  protected readonly isEmulator = this.authService.isUsingEmulator();

  // Store profile temporarily for disabled account flow
  private disabledProfile: UserProfile | null = null;

  protected readonly authError = this.authService.error;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.mode.set(this.initialMode());
        this.resetForm();
      }
    });
  }

  protected setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.localError.set(null);
    this.authService.clearError();
    this.resetSent.set(false);
    this.phoneStep.set('input');
  }

  protected setLoginMethod(method: LoginMethod): void {
    this.loginMethod.set(method);
    this.localError.set(null);
    this.authService.clearError();
    this.phoneStep.set('input');
    
    // Initialize reCAPTCHA for phone login
    if (method === 'phone') {
      setTimeout(() => {
        this.authService.initRecaptcha('phone-signin-btn');
      }, 100);
    }
  }

  protected async onSubmit(): Promise<void> {
    this.localError.set(null);
    this.authService.clearError();

    const currentMode = this.mode();

    if (currentMode === 'signup') {
      if (this.password() !== this.confirmPassword()) {
        this.localError.set('Passwords do not match.');
        return;
      }
      if (this.password().length < 6) {
        this.localError.set('Password must be at least 6 characters.');
        return;
      }
    }

    this.submitting.set(true);

    try {
      switch (currentMode) {
        case 'login': {
          await this.authService.signIn(this.email(), this.password());
          const user = this.authService.user();
          if (user) {
            const profile = await this.userProfileService.loadUserProfile(user.uid);
            
            // Check if account is disabled
            if (profile?.settings?.account?.disabled) {
              this.disabledProfile = profile;
              this.mode.set('disabled');
              return; // Don't emit authenticated - wait for re-enable decision
            }
            
            this.authenticated.emit({ isNewUser: !profile?.onboardingCompleted });
          }
          break;
        }
        case 'disabled': {
          // This case shouldn't be submitted directly
          return;
        }
        case 'signup': {
          await this.authService.signUp(this.email(), this.password(), this.displayName());
          // Create user profile in Firestore
          const user = this.authService.user();
          if (user) {
            try {
            await this.userProfileService.createUserProfile(user.uid, user.displayName);
            } catch (firestoreError) {
              console.error('Failed to create user profile:', firestoreError);
              // Still allow user to proceed - profile can be created later
            }
          }
          this.authenticated.emit({ isNewUser: true });
          break;
        }
        case 'reset':
          await this.authService.resetPassword(this.email());
          this.resetSent.set(true);
          break;
      }
    } catch (error) {
      // Auth errors are handled by authService.error signal
      console.error('Auth error:', error);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onSendPhoneCode(): Promise<void> {
    const phone = this.phoneNumber().trim();
    
    if (!phone) {
      this.localError.set('Please enter your phone number.');
      return;
    }
    
    if (!phone.startsWith('+')) {
      this.localError.set('Please include your country code (e.g., +1 for US).');
      return;
    }
    
    this.submitting.set(true);
    this.localError.set(null);
    this.authService.clearError();
    
    try {
      await this.authService.sendPhoneSignInCode(phone);
      this.phoneStep.set('verify');
    } catch (error) {
      console.error('Failed to send phone code:', error);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onVerifyPhoneCode(): Promise<void> {
    const code = this.verificationCode().trim();
    
    if (!code) {
      this.localError.set('Please enter the verification code.');
      return;
    }
    
    if (code.length !== 6) {
      this.localError.set('Please enter the 6-digit code.');
      return;
    }
    
    this.submitting.set(true);
    this.localError.set(null);
    
    try {
      const user = await this.authService.confirmPhoneSignIn(code);
      
      if (user) {
        // Check if profile exists
        let profile = await this.userProfileService.loadUserProfile(user.uid);
        
        if (!profile) {
          // New phone user - create profile
          await this.userProfileService.createUserProfile(
            user.uid, 
            null, // no display name yet
            {
              phoneNumber: this.phoneNumber(),
              phoneNumberVerified: true,
            }
          );
          this.authenticated.emit({ isNewUser: true });
        } else {
          // Check if account is disabled
          if (profile.settings?.account?.disabled) {
            this.disabledProfile = profile;
            this.mode.set('disabled');
            return;
          }
          this.authenticated.emit({ isNewUser: !profile.onboardingCompleted });
        }
      }
    } catch (error) {
      console.error('Failed to verify phone code:', error);
    } finally {
      this.submitting.set(false);
    }
  }

  protected onResendCode(): void {
    this.phoneStep.set('input');
    this.verificationCode.set('');
    this.localError.set(null);
    this.authService.cleanupRecaptcha();
    
    setTimeout(() => {
      this.authService.initRecaptcha('phone-signin-btn');
    }, 100);
  }

  protected async onGoogleSignIn(): Promise<void> {
    this.submitting.set(true);
    try {
      await this.authService.signInWithGoogle();
      const user = this.authService.user();
      if (user) {
        // Check if profile exists
        const profile = await this.userProfileService.loadUserProfile(user.uid);
        if (!profile) {
          // New Google user - create profile
          await this.userProfileService.createUserProfile(user.uid, user.displayName);
          this.authenticated.emit({ isNewUser: true });
        } else {
          // Check if account is disabled
          if (profile.settings?.account?.disabled) {
            this.disabledProfile = profile;
            this.mode.set('disabled');
            return;
          }
          this.authenticated.emit({ isNewUser: !profile.onboardingCompleted });
        }
      }
    } catch {
      // Error is handled by authService.error signal
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onEnableAccount(): Promise<void> {
    this.enablingAccount.set(true);
    this.localError.set(null);

    try {
      const enableAccountFn = httpsCallable(this.functions, 'enableAccount');
      await enableAccountFn({});

      // Reload profile to get updated settings
      const user = this.authService.user();
      if (user) {
        await this.userProfileService.loadUserProfile(user.uid);
        this.authenticated.emit({ isNewUser: !this.disabledProfile?.onboardingCompleted });
      }
      this.disabledProfile = null;
    } catch (error) {
      console.error('Error enabling account:', error);
      this.localError.set('Failed to enable account. Please try again.');
    } finally {
      this.enablingAccount.set(false);
    }
  }

  protected onCancelEnable(): void {
    // Sign out the user since they chose not to re-enable
    this.authService.signOutUser();
    this.disabledProfile = null;
    this.mode.set('login');
  }

  protected onClose(): void {
    this.closed.emit();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.onClose();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.onClose();
    }
  }

  private resetForm(): void {
    this.email.set('');
    this.password.set('');
    this.confirmPassword.set('');
    this.displayName.set('');
    this.phoneNumber.set('');
    this.verificationCode.set('');
    this.phoneStep.set('input');
    this.loginMethod.set('email');
    this.localError.set(null);
    this.resetSent.set(false);
    this.authService.clearError();
    this.authService.cleanupRecaptcha();
  }
}
