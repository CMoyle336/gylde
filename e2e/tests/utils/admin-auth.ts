/**
 * Admin SDK Authentication Utilities
 * 
 * This module provides rate-limit-free authentication for e2e tests by using
 * Firebase Admin SDK to:
 * 1. Create users directly (bypasses signup rate limits)
 * 2. Generate custom auth tokens (bypasses login rate limits)
 * 3. Inject auth state into the browser
 * 
 * This approach eliminates "too many attempts" errors during testing.
 */

import { Page } from '@playwright/test';
import { getAdminAuth, getAdminDb } from './settings-helpers';

// Control verbose logging via environment variable
const DEBUG = process.env.E2E_DEBUG === 'true';

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

// Cache for created users to avoid recreating them
const createdUsersCache = new Map<string, { uid: string; email: string; customToken?: string }>();

// Auth emulator URL for local development
const AUTH_EMULATOR_URL = process.env.FIREBASE_AUTH_EMULATOR_HOST 
  ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`
  : 'http://localhost:9099';

function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

/**
 * Create a user via Firebase Admin SDK (no rate limits)
 * Returns the UID of the created user
 */
export async function createUserViaAdmin(
  email: string,
  password: string,
  displayName: string
): Promise<{ uid: string; created: boolean }> {
  // Check cache first
  const cached = createdUsersCache.get(email);
  if (cached) {
    debugLog(`[AdminAuth] User ${email} found in cache: ${cached.uid}`);
    return { uid: cached.uid, created: false };
  }

  const isLive = isLiveEnvironment();
  debugLog(`[AdminAuth] Creating user ${email} via ${isLive ? 'Admin SDK' : 'Emulator'}`);

  if (isLive) {
    return createUserViaAdminSdk(email, password, displayName);
  } else {
    return createUserViaEmulator(email, password, displayName);
  }
}

/**
 * Create user via Admin SDK (live environment)
 */
async function createUserViaAdminSdk(
  email: string,
  password: string,
  displayName: string
): Promise<{ uid: string; created: boolean }> {
  const auth = await getAdminAuth();
  if (!auth) {
    throw new Error('Admin Auth not available - check GOOGLE_APPLICATION_CREDENTIALS');
  }

  try {
    // Try to get existing user first
    const existingUser = await auth.getUserByEmail(email).catch(() => null);
    if (existingUser) {
      createdUsersCache.set(email, { uid: existingUser.uid, email });
      return { uid: existingUser.uid, created: false };
    }

    // Create new user
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true, // Skip email verification for test users
    });

    createdUsersCache.set(email, { uid: userRecord.uid, email });
    debugLog(`[AdminAuth] Created user via Admin SDK: ${email} -> ${userRecord.uid}`);
    return { uid: userRecord.uid, created: true };
  } catch (error: any) {
    // If user already exists, get their UID
    if (error.code === 'auth/email-already-exists') {
      const existingUser = await auth.getUserByEmail(email);
      createdUsersCache.set(email, { uid: existingUser.uid, email });
      return { uid: existingUser.uid, created: false };
    }
    throw error;
  }
}

/**
 * Create user via Auth Emulator REST API (local development)
 */
async function createUserViaEmulator(
  email: string,
  password: string,
  displayName: string
): Promise<{ uid: string; created: boolean }> {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  
  // First, try to find existing user
  const listUrl = `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;
  
  try {
    const lookupResponse = await fetch(listUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    });
    
    if (lookupResponse.ok) {
      const data = await lookupResponse.json();
      if (data.users && data.users.length > 0) {
        const uid = data.users[0].localId;
        createdUsersCache.set(email, { uid, email });
        return { uid, created: false };
      }
    }
  } catch {
    // User doesn't exist, continue to create
  }

  // Create new user via emulator
  const signUpUrl = `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;
  
  const response = await fetch(signUpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      displayName,
      returnSecureToken: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    if (error.error?.message === 'EMAIL_EXISTS') {
      // Get the existing user's UID
      const existingUser = await getEmulatorUserByEmail(email, projectId);
      if (existingUser) {
        createdUsersCache.set(email, { uid: existingUser.localId, email });
        return { uid: existingUser.localId, created: false };
      }
    }
    throw new Error(`Failed to create user in emulator: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const uid = data.localId;
  
  createdUsersCache.set(email, { uid, email });
  debugLog(`[AdminAuth] Created user via emulator: ${email} -> ${uid}`);
  return { uid, created: true };
}

/**
 * Get user from emulator by email
 */
async function getEmulatorUserByEmail(email: string, projectId: string): Promise<any | null> {
  // List all users and find by email
  const listUrl = `${AUTH_EMULATOR_URL}/emulator/v1/projects/${projectId}/accounts`;
  
  try {
    const response = await fetch(listUrl);
    if (response.ok) {
      const data = await response.json();
      const user = data.userInfo?.find((u: any) => u.email === email);
      return user || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Generate a custom auth token for a user (bypasses login rate limits)
 */
export async function generateCustomToken(uid: string): Promise<string> {
  if (isLiveEnvironment()) {
    const auth = await getAdminAuth();
    if (!auth) {
      throw new Error('Admin Auth not available');
    }
    return auth.createCustomToken(uid);
  } else {
    // For emulator, we need to use a different approach
    // The emulator supports custom tokens via the REST API
    return generateEmulatorCustomToken(uid);
  }
}

/**
 * Generate custom token via emulator
 * Note: Emulator doesn't directly support createCustomToken via REST,
 * so we use signInWithPassword which doesn't have rate limits in emulator
 */
async function generateEmulatorCustomToken(uid: string): Promise<string> {
  // For emulator, we'll return a special marker that tells the browser
  // to use a different auth approach
  return `emulator:${uid}`;
}

/**
 * Sign in to the app using a custom token (injected into browser)
 * This bypasses all Firebase Auth rate limits
 */
export async function signInWithCustomToken(
  page: Page,
  customToken: string,
  email: string,
  password: string
): Promise<void> {
  const isEmulator = customToken.startsWith('emulator:');
  
  if (isEmulator) {
    // For emulator, use signInWithEmailAndPassword (no rate limits in emulator)
    await signInViaEmulatorInBrowser(page, email, password);
  } else {
    // For live environment, use the custom token
    await signInWithCustomTokenInBrowser(page, customToken);
  }
}

/**
 * Sign in using custom token in the browser
 */
async function signInWithCustomTokenInBrowser(page: Page, customToken: string): Promise<void> {
  // Navigate to app first to ensure Firebase is initialized
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  // Inject script to sign in with custom token
  const signedIn = await page.evaluate(async (token) => {
    // Wait for Firebase to be available
    const waitForFirebase = () => new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        // Check if Firebase Auth is available
        const win = window as any;
        if (win.firebase?.auth || win.__FIREBASE_AUTH__) {
          resolve();
        } else if (attempts > 50) {
          reject(new Error('Firebase not available'));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    try {
      await waitForFirebase();
      
      // Try to use the Firebase SDK directly
      const win = window as any;
      
      // Method 1: Try Angular Fire's auth instance
      if (win.ngDevMode !== undefined) {
        // We're in Angular - need to access the auth service differently
        // This will be handled by the app's auth service
      }
      
      // Method 2: Use the Firebase SDK if available globally
      const { signInWithCustomToken } = await import('firebase/auth');
      const { getAuth } = await import('firebase/auth');
      
      const auth = getAuth();
      await signInWithCustomToken(auth, token);
      
      return true;
    } catch (error) {
      console.error('Custom token sign-in failed:', error);
      return false;
    }
  }, customToken);

  if (!signedIn) {
    throw new Error('Failed to sign in with custom token');
  }

  // Wait for auth state to propagate
  await page.waitForTimeout(1000);
}

/**
 * Sign in using email/password via emulator (no rate limits)
 */
async function signInViaEmulatorInBrowser(page: Page, email: string, password: string): Promise<void> {
  // Navigate to app first
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  // Use Firebase SDK to sign in directly
  const signedIn = await page.evaluate(async ({ email, password }) => {
    try {
      const { signInWithEmailAndPassword, getAuth } = await import('firebase/auth');
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (error) {
      console.error('Emulator sign-in failed:', error);
      return false;
    }
  }, { email, password });

  if (!signedIn) {
    throw new Error('Failed to sign in via emulator');
  }

  // Wait for auth state to propagate
  await page.waitForTimeout(1000);
}

/**
 * Complete the onboarding flow via direct Firestore writes
 * This is much faster than going through the UI
 */
export async function completeOnboardingViaAdmin(
  uid: string,
  userData: {
    displayName: string;
    birthDate: Date;
    city: string;
    gender: 'man' | 'woman' | 'nonbinary';
    interestedIn: ('men' | 'women' | 'nonbinary')[];
    tagline: string;
    photoUrl?: string;
    hasPrivateContent?: boolean;
  }
): Promise<void> {
  const db = await getAdminDb();
  
  if (isLiveEnvironment()) {
    if (!db) {
      throw new Error('Admin Firestore not available');
    }
    await completeOnboardingViaAdminSdk(db, uid, userData);
  } else {
    await completeOnboardingViaEmulator(uid, userData);
  }
}

/**
 * Complete onboarding via Admin SDK (live)
 */
async function completeOnboardingViaAdminSdk(
  db: any,
  uid: string,
  userData: {
    displayName: string;
    birthDate: Date;
    city: string;
    gender: 'man' | 'woman' | 'nonbinary';
    interestedIn: ('men' | 'women' | 'nonbinary')[];
    tagline: string;
    photoUrl?: string;
    hasPrivateContent?: boolean;
  }
): Promise<void> {
  const now = new Date();
  
  // Build photo details array matching the expected structure
  const photoDetails: Array<{
    id: string;
    url: string;
    isPrivate: boolean;
    uploadedAt: Date;
    order: number;
  }> = [];
  
  if (userData.photoUrl) {
    // First photo is always public (profile photo)
    photoDetails.push({
      id: `photo-${Date.now()}-0`,
      url: userData.photoUrl,
      isPrivate: false,
      uploadedAt: now,
      order: 0,
    });
    
    // If hasPrivateContent, add a private photo
    if (userData.hasPrivateContent) {
      photoDetails.push({
        id: `photo-${Date.now()}-1`,
        url: userData.photoUrl, // Reuse the same image for testing
        isPrivate: true,
        uploadedAt: now,
        order: 1,
      });
    }
  }
  
  // Create the user document matching UserProfile interface
  const userDoc = {
    uid,
    displayName: userData.displayName,
    photoURL: userData.photoUrl || null, // Primary photo URL for display
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    sortableLastActive: now,
    isSearchable: true,
    
    // CRITICAL: This must be 'onboardingCompleted' not 'onboardingComplete'
    onboardingCompleted: true,
    
    // Onboarding data nested under 'onboarding' property
    onboarding: {
      birthDate: userData.birthDate.toISOString().split('T')[0], // YYYY-MM-DD format
      city: userData.city,
      country: 'United States',
      genderIdentity: userData.gender,
      interestedIn: userData.interestedIn,
      ageRangeMin: 18,
      ageRangeMax: 65,
      connectionTypes: ['long-term'],
      supportOrientation: '',
      tagline: userData.tagline,
      idealRelationship: 'Someone who values honesty.',
      photoDetails: photoDetails, // Must be 'photoDetails' not 'photos'
      verificationOptions: [],
    },
    
    settings: {
      privacy: {
        showOnlineStatus: true,
        showLastActive: true,
        profileVisible: true,
        showLocation: true,
      },
      activity: {
        createOnView: true,
        createOnFavorite: true,
      },
      account: {
        disabled: false,
      },
    },
  };

  await db.doc(`users/${uid}`).set(userDoc, { merge: true });
  debugLog(`[AdminAuth] Completed onboarding for user: ${uid}`);
}

/**
 * Complete onboarding via Firestore emulator REST API
 */
async function completeOnboardingViaEmulator(
  uid: string,
  userData: {
    displayName: string;
    birthDate: Date;
    city: string;
    gender: 'man' | 'woman' | 'nonbinary';
    interestedIn: ('men' | 'women' | 'nonbinary')[];
    tagline: string;
    photoUrl?: string;
    hasPrivateContent?: boolean;
  }
): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  const firestoreEmulatorUrl = process.env.FIRESTORE_EMULATOR_HOST 
    ? `http://${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'http://localhost:8080';
  
  const now = new Date().toISOString();
  const birthDateStr = userData.birthDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Build photoDetails array in Firestore REST format
  const photoDetailsValues: Array<{ mapValue: { fields: Record<string, any> } }> = [];
  
  if (userData.photoUrl) {
    // First photo is always public (profile photo)
    photoDetailsValues.push({
      mapValue: {
        fields: {
          id: { stringValue: `photo-${Date.now()}-0` },
          url: { stringValue: userData.photoUrl },
          isPrivate: { booleanValue: false },
          uploadedAt: { timestampValue: now },
          order: { integerValue: '0' },
        },
      },
    });
    
    // If hasPrivateContent, add a private photo
    if (userData.hasPrivateContent) {
      photoDetailsValues.push({
        mapValue: {
          fields: {
            id: { stringValue: `photo-${Date.now()}-1` },
            url: { stringValue: userData.photoUrl }, // Reuse the same image for testing
            isPrivate: { booleanValue: true },
            uploadedAt: { timestampValue: now },
            order: { integerValue: '1' },
          },
        },
      });
    }
  }

  // Convert to Firestore REST format - matching UserProfile interface
  const fields: Record<string, any> = {
    uid: { stringValue: uid },
    displayName: { stringValue: userData.displayName },
    photoURL: userData.photoUrl ? { stringValue: userData.photoUrl } : { nullValue: null },
    createdAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
    lastActiveAt: { timestampValue: now },
    sortableLastActive: { timestampValue: now },
    isSearchable: { booleanValue: true },
    
    // CRITICAL: This must be 'onboardingCompleted' not 'onboardingComplete'
    onboardingCompleted: { booleanValue: true },
    
    // Onboarding data nested under 'onboarding' property
    onboarding: {
      mapValue: {
        fields: {
          birthDate: { stringValue: birthDateStr },
          city: { stringValue: userData.city },
          country: { stringValue: 'United States' },
          genderIdentity: { stringValue: userData.gender },
          interestedIn: { 
            arrayValue: { 
              values: userData.interestedIn.map(i => ({ stringValue: i })) 
            } 
          },
          ageRangeMin: { integerValue: '18' },
          ageRangeMax: { integerValue: '65' },
          connectionTypes: { 
            arrayValue: { 
              values: [{ stringValue: 'long-term' }] 
            } 
          },
          supportOrientation: { stringValue: '' },
          tagline: { stringValue: userData.tagline },
          idealRelationship: { stringValue: 'Someone who values honesty.' },
          photoDetails: { 
            arrayValue: { 
              values: photoDetailsValues 
            } 
          },
          verificationOptions: { 
            arrayValue: { 
              values: [] 
            } 
          },
        },
      },
    },
    
    settings: {
      mapValue: {
        fields: {
          privacy: {
            mapValue: {
              fields: {
                showOnlineStatus: { booleanValue: true },
                showLastActive: { booleanValue: true },
                profileVisible: { booleanValue: true },
                showLocation: { booleanValue: true },
              },
            },
          },
          activity: {
            mapValue: {
              fields: {
                createOnView: { booleanValue: true },
                createOnFavorite: { booleanValue: true },
              },
            },
          },
          account: {
            mapValue: {
              fields: {
                disabled: { booleanValue: false },
              },
            },
          },
        },
      },
    },
  };

  const docPath = `projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const url = `${firestoreEmulatorUrl}/v1/${docPath}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to complete onboarding via emulator: ${error}`);
  }

  // Verify the document was written correctly
  const verifyUrl = `${firestoreEmulatorUrl}/v1/${docPath}`;
  const verifyResponse = await fetch(verifyUrl, {
    headers: { 'Authorization': 'Bearer owner' },
  });
  
  if (verifyResponse.ok) {
    const doc = await verifyResponse.json();
    const onboardingCompleted = doc?.fields?.onboardingCompleted?.booleanValue;
    if (onboardingCompleted !== true) {
      console.warn(`[AdminAuth] WARNING: Document written but onboardingCompleted is ${onboardingCompleted}`);
    } else {
      debugLog(`[AdminAuth] Verified: onboardingCompleted = true for ${uid}`);
    }
  }

  debugLog(`[AdminAuth] Completed onboarding for user via emulator: ${uid}`);
}

/**
 * Clear the user cache (useful between test runs)
 */
export function clearUserCache(): void {
  createdUsersCache.clear();
}

/**
 * Delete a test user (cleanup)
 */
export async function deleteTestUser(uid: string): Promise<void> {
  if (isLiveEnvironment()) {
    const auth = await getAdminAuth();
    if (auth) {
      try {
        await auth.deleteUser(uid);
        debugLog(`[AdminAuth] Deleted user: ${uid}`);
      } catch (error) {
        debugLog(`[AdminAuth] Failed to delete user ${uid}:`, error);
      }
    }
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
    const deleteUrl = `${AUTH_EMULATOR_URL}/emulator/v1/projects/${projectId}/accounts/${uid}`;
    
    try {
      await fetch(deleteUrl, { method: 'DELETE' });
      debugLog(`[AdminAuth] Deleted user via emulator: ${uid}`);
    } catch (error) {
      debugLog(`[AdminAuth] Failed to delete user ${uid} via emulator:`, error);
    }
  }

  // Remove from cache
  for (const [email, cached] of createdUsersCache.entries()) {
    if (cached.uid === uid) {
      createdUsersCache.delete(email);
      break;
    }
  }
}
