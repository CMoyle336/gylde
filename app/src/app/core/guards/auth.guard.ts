import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserProfileService } from '../services/user-profile.service';

export const authGuard: CanActivateFn = async () => {
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);
  const router = inject(Router);

  // Skip guard on server - let client handle auth
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // Wait for auth to initialize on page refresh
  await authService.waitForAuthReady();

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/']);
  return false;
};

/**
 * Guard for home/guest pages - redirects logged in users appropriately
 * - Logged in + onboarding complete → dashboard
 * - Logged in + onboarding incomplete → onboarding
 * - Not logged in → allow access
 */
export const guestGuard: CanActivateFn = async () => {
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);
  const userProfileService = inject(UserProfileService);
  const router = inject(Router);

  // Skip guard on server - let client handle auth
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // Wait for auth to initialize on page refresh
  await authService.waitForAuthReady();

  if (!authService.isAuthenticated()) {
    return true;
  }

  const user = authService.user();
  if (!user) {
    return true;
  }

  // Load profile to check onboarding status
  let profile = userProfileService.profile();
  if (!profile) {
    profile = await userProfileService.loadUserProfile(user.uid);
  }

  if (profile?.onboardingCompleted) {
    router.navigate(['/dashboard']);
  } else {
    router.navigate(['/onboarding']);
  }
  return false;
};

/**
 * Guard to ensure user has completed onboarding before accessing dashboard
 */
export const onboardingCompleteGuard: CanActivateFn = async () => {
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);
  const userProfileService = inject(UserProfileService);
  const router = inject(Router);

  // Skip guard on server - let client handle auth
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // Wait for auth to initialize on page refresh
  await authService.waitForAuthReady();

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
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);
  const userProfileService = inject(UserProfileService);
  const router = inject(Router);

  // Skip guard on server - let client handle auth
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // Wait for auth to initialize on page refresh
  await authService.waitForAuthReady();

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
