import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { TEST_USERS, DISCOVER_TEST_USERS, TestUser, getAllTestUsers } from './test-users';
import dotenv from 'dotenv';
import path from 'path';
import { getRunId, makeUniqueUser, provisionUser as provisionUserInternal, type ProvisionedUser } from '../utils/user-provisioning';
import { mockRemoteConfig, clearRemoteConfigMock, MockRemoteConfigValues, REMOTE_CONFIG_DEFAULTS } from './remote-config.fixture';
import { generateCustomToken } from '../utils/admin-auth';
import { getAdminAuth } from '../utils/settings-helpers';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Detect live environment for timeout adjustment
function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

// Simple in-memory rate limiter to prevent too many concurrent Firebase logins
// This helps avoid quota issues when running tests in parallel
// Note: This only works within a single worker process - use limited workers in playwright.config.ts
const loginQueue: { resolve: () => void }[] = [];
let activeLogins = 0;
const MAX_CONCURRENT_LOGINS = isLiveEnvironment() ? 1 : 5; // Only 1 login at a time per worker for live
const LOGIN_DELAY_MS = isLiveEnvironment() ? 2000 : 0; // Delay between logins for live env

async function acquireLoginSlot(): Promise<void> {
  if (activeLogins < MAX_CONCURRENT_LOGINS) {
    activeLogins++;
    if (LOGIN_DELAY_MS > 0) {
      // Add random jitter to prevent workers from syncing up
      const jitter = Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, LOGIN_DELAY_MS + jitter));
    }
    return;
  }
  
  // Wait in queue
  await new Promise<void>(resolve => {
    loginQueue.push({ resolve });
  });
  activeLogins++;
  
  // Add delay when coming out of queue
  if (LOGIN_DELAY_MS > 0) {
    const jitter = Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, LOGIN_DELAY_MS + jitter));
  }
}

function releaseLoginSlot(): void {
  activeLogins--;
  if (loginQueue.length > 0) {
    const next = loginQueue.shift();
    next?.resolve();
  }
}

/**
 * Login strategy:
 * - 'custom-token': Use Firebase custom tokens (no rate limits, recommended)
 * - 'ui': Use UI login flow (subject to rate limits)
 */
type LoginStrategy = 'custom-token' | 'ui';

function getLoginStrategy(): LoginStrategy {
  const override = process.env.E2E_LOGIN_STRATEGY;
  if (override === 'ui' || override === 'custom-token') {
    return override;
  }
  // Default to UI login - the main rate limit issue is signup (solved by Admin SDK)
  // Login rate limits are much higher and UI login is more reliable
  // Custom token injection into IndexedDB is unreliable
  return 'ui';
}

/**
 * Exchange a custom token for an ID token via Firebase REST API
 * This bypasses the need to access the in-app Firebase SDK
 */
async function exchangeCustomTokenForIdToken(customToken: string, apiKey: string): Promise<{
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: customToken,
      returnSecureToken: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token exchange failed: ${error.error?.message || JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Login via custom token (NO RATE LIMITS!)
 * This is the preferred method for live environments.
 * 
 * Process:
 * 1. Generate custom token via Admin SDK
 * 2. Exchange custom token for ID token via Firebase REST API
 * 3. Inject auth state into browser's IndexedDB
 * 4. Navigate to app (it will pick up the auth state)
 */
async function loginViaCustomToken(page: Page, user: TestUser & { uid?: string }): Promise<void> {
  if (!user.uid) {
    throw new Error(`Cannot login with custom token: user ${user.email} has no UID`);
  }

  console.log(`[Auth] Logging in via custom token: ${user.email}`);
  
  // Generate custom token using Admin SDK
  const customToken = await generateCustomToken(user.uid);
  
  // For emulator, fall back to UI login (emulator doesn't have rate limits anyway)
  const isEmulator = customToken.startsWith('emulator:');
  if (isEmulator) {
    console.log(`[Auth] Emulator detected, using UI login (no rate limits in emulator)`);
    await loginViaUI(page, user);
    return;
  }

  // Get the Firebase API key from environment or use the one from the app
  const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyC-Kz_yGQK1fhXHsKjT9Q2vMdMq-Zy3qZI';
  
  // Exchange custom token for ID token via REST API
  console.log(`[Auth] Exchanging custom token for ID token...`);
  const tokenResponse = await exchangeCustomTokenForIdToken(customToken, apiKey);
  
  // Navigate to the app first (to set up the correct origin for storage)
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  // Wait for app to initialize
  await page.waitForSelector('app-root', { timeout: 10000 });
  await page.waitForTimeout(500);
  
  // Inject the auth state into IndexedDB (where Firebase stores auth)
  // This simulates what Firebase SDK does after successful authentication
  const authInjected = await page.evaluate(async ({ uid, idToken, refreshToken, email, displayName, apiKey }) => {
    try {
      // Firebase stores auth state in IndexedDB under 'firebaseLocalStorageDb'
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const request = indexedDB.open('firebaseLocalStorageDb', 1);
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage');
          }
        };
        
        request.onsuccess = () => {
          const db = request.result;
          
          // Check if object store exists
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.close();
            resolve({ success: false, error: 'firebaseLocalStorage store not found' });
            return;
          }
          
          const tx = db.transaction('firebaseLocalStorage', 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          
          // Get all keys to find the correct storage key
          const getAllRequest = store.getAllKeys();
          getAllRequest.onsuccess = () => {
            const keys = getAllRequest.result;
            // Find the key that looks like firebase:authUser:*
            let authKey = keys.find(k => String(k).includes('authUser'));
            
            // If no existing key, create one with the app's API key
            if (!authKey) {
              // Use a generic key format that Firebase will recognize
              authKey = `firebase:authUser:${uid}:[DEFAULT]`;
            }
            
            // Create auth user object that Firebase expects
            const authUser = {
              uid,
              email,
              displayName: displayName || email?.split('@')[0],
              emailVerified: true,
              isAnonymous: false,
              providerData: [{
                providerId: 'password',
                uid: email,
                displayName: displayName || null,
                email,
                phoneNumber: null,
                photoURL: null,
              }],
              stsTokenManager: {
                refreshToken,
                accessToken: idToken,
                expirationTime: Date.now() + 3600 * 1000, // 1 hour from now
              },
              createdAt: String(Date.now()),
              lastLoginAt: String(Date.now()),
              apiKey,
              appName: '[DEFAULT]',
            };
            
            const putRequest = store.put({ fbase_key: String(authKey), value: authUser }, authKey);
            
            putRequest.onsuccess = () => {
              db.close();
              resolve({ success: true });
            };
            
            putRequest.onerror = () => {
              db.close();
              resolve({ success: false, error: 'Failed to store auth data' });
            };
          };
          
          getAllRequest.onerror = () => {
            db.close();
            resolve({ success: false, error: 'Failed to get keys' });
          };
        };
        
        request.onerror = () => {
          resolve({ success: false, error: 'Failed to open IndexedDB' });
        };
        
        // Timeout after 5 seconds
        setTimeout(() => resolve({ success: false, error: 'IndexedDB operation timed out' }), 5000);
      });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }, { 
    uid: user.uid, 
    idToken: tokenResponse.idToken, 
    refreshToken: tokenResponse.refreshToken,
    email: user.email,
    displayName: user.displayName,
    apiKey,
  });

  if (!authInjected.success) {
    throw new Error(`Failed to inject auth state: ${authInjected.error}`);
  }

  console.log(`[Auth] Auth state injected, reloading app...`);
  
  // Reload the page so the app picks up the injected auth state
  await page.reload({ waitUntil: 'domcontentloaded' });
  
  // Navigate to discover to trigger auth check
  await page.goto('/discover');
  await page.waitForURL(/\/(discover|messages|settings|favorites|onboarding)/, { timeout: 30000 });
  
  console.log(`[Auth] Login successful: ${user.email}`);
}

/**
 * Login helper - uses custom token by default to avoid rate limits
 */
async function loginAs(page: Page, context: BrowserContext, user: TestUser & { uid?: string }): Promise<void> {
  const strategy = getLoginStrategy();
  
  if (strategy === 'custom-token' && user.uid) {
    try {
      await loginViaCustomToken(page, user);
      return;
    } catch (error) {
      console.warn(`[Auth] Custom token login failed, falling back to UI:`, error);
      // Fall back to UI login
    }
  }
  
  await loginViaUI(page, user);
}

/**
 * Login via UI - performs a login through the UI with rate limiting
 */
async function loginViaUI(page: Page, user: TestUser, retryCount = 0, isQuotaRetry = false): Promise<void> {
  const isLive = isLiveEnvironment();
  const loginTimeout = isLive ? 60000 : 15000; // Increased timeout for live environments
  // More retries for quota errors (they often clear after a wait)
  const maxRetries = isQuotaRetry ? 5 : (isLive ? 3 : 1);
  
  // Acquire a login slot to prevent too many concurrent Firebase auth requests
  await acquireLoginSlot();
  
  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // Open auth modal
    const getStartedBtn = page.getByRole('button', { name: /get started/i });
    await getStartedBtn.waitFor({ state: 'visible', timeout: 10000 });
    await getStartedBtn.click();
    
    await page.locator('.modal-backdrop').waitFor({ timeout: 10000 });
    
    // Switch to login mode (modal opens in signup mode by default)
    await page.locator('.auth-switch button').click();
    await page.waitForTimeout(300);
    
    // Fill credentials
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    
    // Submit
    await page.locator('.submit-btn').click();
    
    // Wait for redirect to authenticated page
    await page.waitForURL(/\/(discover|messages|settings|favorites|onboarding)/, { timeout: loginTimeout });
    
    if (page.url().includes('/onboarding')) {
      console.log(`Warning: User ${user.email} redirected to onboarding`);
    }
    
    // Release slot on success
    releaseLoginSlot();
  } catch (error) {
    // Release slot before retry
    releaseLoginSlot();
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isBrowserClosed = errorMessage.includes('Target page, context or browser has been closed') ||
                            errorMessage.includes('Target closed') ||
                            errorMessage.includes('browser has been closed');
    
    if (isBrowserClosed) {
      throw error;
    }
    
    // Check for quota exceeded error - needs longer wait
    const errorText = await page.locator('[role="alert"]').textContent().catch(() => '');
    const isQuotaError = errorText?.toLowerCase().includes('quota') || 
                          errorMessage.toLowerCase().includes('quota');
    
    // For quota errors, use higher retry limit
    const effectiveMaxRetries = isQuotaError ? 5 : maxRetries;
    
    if (retryCount < effectiveMaxRetries) {
      const waitTime = isQuotaError ? 15000 * (retryCount + 1) : 3000;
      console.log(`Login attempt ${retryCount + 1} failed for ${user.email}${isQuotaError ? ' (quota exceeded)' : ''}, retrying in ${waitTime/1000}s...`);
      try {
        await page.waitForTimeout(waitTime);
      } catch {
        throw error;
      }
      return loginViaUI(page, user, retryCount + 1, isQuotaError);
    }
    throw error;
  }
}

/**
 * Extended test with auth helpers
 * 
 * Users are created in global setup before tests run.
 * Auth state is saved and reused to avoid Firebase quota issues.
 * 
 * Usage:
 *   - loginAsAlice(): Login as the primary female test user
 *   - loginAsBob(): Login as the primary male test user  
 *   - loginAs(user): Login as any TestUser
 *   - alice, bob: Access to user data for assertions
 */
export const test = base.extend<{
  // Per-test unique users (created & onboarded automatically)
  alice: ProvisionedUser;
  bob: ProvisionedUser;

  // Create additional unique users from templates
  provisionUser: (template: TestUser, label?: string) => Promise<ProvisionedUser>;

  // Per-serial-suite users (cached by describe titlePath)
  provisionSuiteUser: (template: TestUser, label?: string) => Promise<ProvisionedUser>;
  suiteAlice: ProvisionedUser;
  suiteBob: ProvisionedUser;

  loginAsSuiteAlice: () => Promise<void>;
  loginAsSuiteBob: () => Promise<void>;
  
  // Login helpers
  loginAsAlice: () => Promise<void>;
  loginAsBob: () => Promise<void>;
  loginAs: (user: TestUser) => Promise<void>;

  // Remote Config mocking
  mockRemoteConfig: (values: MockRemoteConfigValues) => Promise<void>;
  clearRemoteConfigMock: () => Promise<void>;
}>({
  provisionUser: async ({ browser }, use, testInfo) => {
    const runId = getRunId();
    const cache = new Map<string, ProvisionedUser>();

    await use(async (template: TestUser, label?: string) => {
      const key = `${label || template.id}::${template.id}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const unique = makeUniqueUser(template, {
        runId,
        workerIndex: testInfo.workerIndex,
        testId: testInfo.testId,
        label,
      });
      const created = await provisionUserInternal(browser, unique, { runId });
      cache.set(key, created);
      return created;
    });
  },

  provisionSuiteUser: async ({ browser }, use, testInfo) => {
    const runId = getRunId();
    // Cache across tests in the same worker for the same suite (describe.serial recommended).
    const suiteKey = testInfo.titlePath.slice(0, -1).join(' > ');
    const globalKeyPrefix = `${testInfo.project.name}::${testInfo.workerIndex}::${suiteKey}`;
    const globalCache = (globalThis as any).__GYLDE_E2E_SUITE_USER_CACHE__ as Map<string, ProvisionedUser> | undefined;
    const cache: Map<string, ProvisionedUser> =
      globalCache ?? new Map<string, ProvisionedUser>();
    (globalThis as any).__GYLDE_E2E_SUITE_USER_CACHE__ = cache;

    await use(async (template: TestUser, label?: string) => {
      const key = `${globalKeyPrefix}::${label || template.id}::${template.id}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const unique = makeUniqueUser(template, {
        runId,
        workerIndex: testInfo.workerIndex,
        testId: `${suiteKey}::${label || template.id}`,
        label,
      });
      const created = await provisionUserInternal(browser, unique, { runId });
      cache.set(key, created);
      return created;
    });
  },

  alice: async ({ provisionUser }, use) => {
    await use(await provisionUser(TEST_USERS.alice, 'alice'));
  },

  bob: async ({ provisionUser }, use) => {
    await use(await provisionUser(TEST_USERS.bob, 'bob'));
  },

  suiteAlice: async ({ provisionSuiteUser }, use) => {
    await use(await provisionSuiteUser(TEST_USERS.alice, 'alice'));
  },

  suiteBob: async ({ provisionSuiteUser }, use) => {
    await use(await provisionSuiteUser(TEST_USERS.bob, 'bob'));
  },

  // Login as Alice (primary female user)
  loginAsAlice: async ({ page, context, alice }, use) => {
    await use(async () => {
      await loginAs(page, context, alice);
    });
  },

  // Login as Bob (primary male user)
  loginAsBob: async ({ page, context, bob }, use) => {
    await use(async () => {
      await loginAs(page, context, bob);
    });
  },

  loginAsSuiteAlice: async ({ page, context, suiteAlice }, use) => {
    await use(async () => {
      await loginAs(page, context, suiteAlice);
    });
  },

  loginAsSuiteBob: async ({ page, context, suiteBob }, use) => {
    await use(async () => {
      await loginAs(page, context, suiteBob);
    });
  },

  // Generic login - use for any user
  loginAs: async ({ page, context }, use) => {
    await use(async (user: TestUser) => {
      await loginAs(page, context, user);
    });
  },

  // Remote Config mocking - set before navigating to pages that use config
  mockRemoteConfig: async ({ page }, use) => {
    await use(async (values: MockRemoteConfigValues) => {
      await mockRemoteConfig(page, values);
    });
  },

  clearRemoteConfigMock: async ({ page }, use) => {
    await use(async () => {
      await clearRemoteConfigMock(page);
    });
  },
});

export { expect };
export { TEST_USERS, DISCOVER_TEST_USERS, getAllTestUsers };
export { REMOTE_CONFIG_DEFAULTS };
export type { TestUser, MockRemoteConfigValues };
