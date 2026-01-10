import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserProfileService } from '../services/user-profile.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/dashboard']);
  return false;
};

/**
 * Guard to ensure user has completed onboarding before accessing dashboard
 */
export const onboardingCompleteGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const userProfileService = inject(UserProfileService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/']);
    return false;
  }

  const user = authService.user();
  if (!user) {
    router.navigate(['/']);
    return false;
  }

  // Load profile if not already loaded
  let profile = userProfileService.profile();
  if (!profile) {
    profile = await userProfileService.loadUserProfile(user.uid);
  }

  if (profile?.onboardingCompleted) {
    return true;
  }

  // Redirect to onboarding if not complete
  router.navigate(['/onboarding']);
  return false;
};

/**
 * Guard to redirect users who already completed onboarding away from onboarding page
 */
export const onboardingIncompleteGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const userProfileService = inject(UserProfileService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/']);
    return false;
  }

  const user = authService.user();
  if (!user) {
    router.navigate(['/']);
    return false;
  }

  // Load profile if not already loaded
  let profile = userProfileService.profile();
  if (!profile) {
    profile = await userProfileService.loadUserProfile(user.uid);
  }

  if (!profile || !profile.onboardingCompleted) {
    return true;
  }

  // Redirect to dashboard if onboarding already complete
  router.navigate(['/dashboard']);
  return false;
};
