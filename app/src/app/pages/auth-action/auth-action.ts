import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Auth, applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from '@angular/fire/auth';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

type ActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'revertSecondFactorAddition';

interface ActionState {
  status: 'loading' | 'input' | 'success' | 'error';
  message: string;
  email?: string;
}

@Component({
  selector: 'app-auth-action',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './auth-action.html',
  styleUrl: './auth-action.css',
})
export class AuthActionComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(Auth);
  private fb = inject(FormBuilder);

  mode = signal<ActionMode | null>(null);
  state = signal<ActionState>({ status: 'loading', message: 'Processing...' });
  
  passwordForm: FormGroup = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  });

  private oobCode: string | null = null;
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);

  ngOnInit() {
    const params = this.route.snapshot.queryParams;
    this.mode.set(params['mode'] as ActionMode);
    this.oobCode = params['oobCode'];

    if (!this.mode() || !this.oobCode) {
      this.state.set({
        status: 'error',
        message: 'Invalid action link. Please request a new one.',
      });
      return;
    }

    this.handleAction();
  }

  private async handleAction() {
    const mode = this.mode();
    
    switch (mode) {
      case 'verifyEmail':
        await this.handleVerifyEmail();
        break;
      case 'resetPassword':
        await this.handleResetPasswordInit();
        break;
      case 'recoverEmail':
        await this.handleRecoverEmail();
        break;
      case 'revertSecondFactorAddition':
        await this.handleRevertSecondFactor();
        break;
      default:
        this.state.set({
          status: 'error',
          message: 'Unknown action type.',
        });
    }
  }

  private async handleVerifyEmail() {
    try {
      await applyActionCode(this.auth, this.oobCode!);
      this.state.set({
        status: 'success',
        message: 'Your email has been verified successfully!',
      });
    } catch (error: unknown) {
      console.error('Email verification error:', error);
      this.state.set({
        status: 'error',
        message: this.getErrorMessage(error),
      });
    }
  }

  private async handleResetPasswordInit() {
    try {
      const email = await verifyPasswordResetCode(this.auth, this.oobCode!);
      this.state.set({
        status: 'input',
        message: 'Enter your new password',
        email,
      });
    } catch (error: unknown) {
      console.error('Password reset verification error:', error);
      this.state.set({
        status: 'error',
        message: this.getErrorMessage(error),
      });
    }
  }

  async submitNewPassword() {
    if (this.passwordForm.invalid) return;
    
    const { password, confirmPassword } = this.passwordForm.value;
    
    if (password !== confirmPassword) {
      this.state.set({
        status: 'input',
        message: 'Passwords do not match',
        email: this.state().email,
      });
      return;
    }

    this.state.set({ status: 'loading', message: 'Updating password...' });

    try {
      await confirmPasswordReset(this.auth, this.oobCode!, password);
      this.state.set({
        status: 'success',
        message: 'Your password has been reset successfully!',
      });
    } catch (error: unknown) {
      console.error('Password reset error:', error);
      this.state.set({
        status: 'error',
        message: this.getErrorMessage(error),
      });
    }
  }

  private async handleRecoverEmail() {
    try {
      const info = await checkActionCode(this.auth, this.oobCode!);
      await applyActionCode(this.auth, this.oobCode!);
      
      this.state.set({
        status: 'success',
        message: `Your email has been reverted to ${info.data.email}. If you didn't request this change, please reset your password immediately.`,
      });
    } catch (error: unknown) {
      console.error('Email recovery error:', error);
      this.state.set({
        status: 'error',
        message: this.getErrorMessage(error),
      });
    }
  }

  private async handleRevertSecondFactor() {
    try {
      await applyActionCode(this.auth, this.oobCode!);
      this.state.set({
        status: 'success',
        message: 'Two-factor authentication has been removed from your account.',
      });
    } catch (error: unknown) {
      console.error('2FA revert error:', error);
      this.state.set({
        status: 'error',
        message: this.getErrorMessage(error),
      });
    }
  }

  private getErrorMessage(error: unknown): string {
    const firebaseError = error as { code?: string };
    
    switch (firebaseError.code) {
      case 'auth/expired-action-code':
        return 'This link has expired. Please request a new one.';
      case 'auth/invalid-action-code':
        return 'This link is invalid or has already been used. Please request a new one.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/user-not-found':
        return 'No account found for this action.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 8 characters.';
      default:
        return 'An error occurred. Please try again or request a new link.';
    }
  }

  getTitle(): string {
    switch (this.mode()) {
      case 'verifyEmail':
        return 'Email Verification';
      case 'resetPassword':
        return 'Reset Password';
      case 'recoverEmail':
        return 'Recover Email';
      case 'revertSecondFactorAddition':
        return 'Remove Two-Factor Auth';
      default:
        return 'Account Action';
    }
  }

  getIcon(): string {
    switch (this.mode()) {
      case 'verifyEmail':
        return 'mark_email_read';
      case 'resetPassword':
        return 'lock_reset';
      case 'recoverEmail':
        return 'email';
      case 'revertSecondFactorAddition':
        return 'security';
      default:
        return 'settings';
    }
  }

  goToLogin() {
    this.router.navigate(['/']);
  }

  togglePasswordVisibility() {
    this.hidePassword.update(v => !v);
  }

  toggleConfirmPasswordVisibility() {
    this.hideConfirmPassword.update(v => !v);
  }
}
