import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserProfileService } from '../services/user-profile.service';

/**
 * Helper to check if user's account is disabled and sign them out if so
 */
async function checkAndHandleDisabledAccount(
  authService: AuthService,
  userProfileService: UserProfileService,
  router: Router
): Promise<boolean> {
  const user = authService.user();
  if (!user) return false;

  let profile = userProfileService.profile();
  if (!profile) {
    profile = await userProfileService.loadUserProfile(user.uid);
  }

  if (profile?.settings?.account?.disabled === true) {
    // Account is disabled - sign out and redirect to home
    await authService.signOutUser();
    router.navigate(['/']);
    return true; // Account is disabled
  }

  return false; // Account is not disabled
}

export const authGuard: CanActivateFn = async () => {
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

  // Check if account is disabled
  const isDisabled = await checkAndHandleDisabledAccount(authService, userProfileService, router);
  if (isDisabled) {
    return false;
  }

  return true;
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
    router.navigate(['/discover']);
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

  // Check if account is disabled
  if (profile?.settings?.account?.disabled === true) {
    await authService.signOutUser();
    router.navigate(['/']);
    return false;
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

  // Check if account is disabled
  if (profile?.settings?.account?.disabled === true) {
    await authService.signOutUser();
    router.navigate(['/']);
    return false;
  }

  if (!profile || !profile.onboardingCompleted) {
    return true;
  }

  // Redirect to discover if onboarding already complete
  router.navigate(['/discover']);
  return false;
};
