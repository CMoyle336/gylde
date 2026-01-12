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
} from '@angular/fire/auth';
import { AuthUser } from '../interfaces';

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

  readonly user = this._user.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  constructor() {
    this.authReadyPromise = new Promise((resolve) => {
      this.authReadyResolve = resolve;
    });
    this.initAuthListener();
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
}
