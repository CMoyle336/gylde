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
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { AuthResult } from '../../core/interfaces';

type AuthMode = 'login' | 'signup' | 'reset';

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

  readonly isOpen = input.required<boolean>();
  readonly initialMode = input<AuthMode>('login');
  readonly closed = output<void>();
  readonly authenticated = output<AuthResult>();

  protected readonly mode = signal<AuthMode>('login');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly displayName = signal('');
  protected readonly submitting = signal(false);
  protected readonly localError = signal<string | null>(null);
  protected readonly resetSent = signal(false);

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
          // Check if user has completed onboarding
          const user = this.authService.user();
          if (user) {
            const profile = await this.userProfileService.loadUserProfile(user.uid);
            this.authenticated.emit({ isNewUser: !profile?.onboardingCompleted });
          }
          break;
        }
        case 'signup': {
          await this.authService.signUp(this.email(), this.password(), this.displayName());
          // Create user profile in Firestore
          const user = this.authService.user();
          if (user) {
            try {
            await this.userProfileService.createUserProfile(user.uid, user.email, user.displayName);
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
          await this.userProfileService.createUserProfile(user.uid, user.email, user.displayName);
          this.authenticated.emit({ isNewUser: true });
        } else {
          this.authenticated.emit({ isNewUser: !profile.onboardingCompleted });
        }
      }
    } catch {
      // Error is handled by authService.error signal
    } finally {
      this.submitting.set(false);
    }
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
    this.localError.set(null);
    this.resetSent.set(false);
    this.authService.clearError();
  }
}
