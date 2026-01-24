import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { TEST_USERS, DISCOVER_TEST_USERS, TestUser, getAllTestUsers } from './test-users';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Directory where auth states are saved by global setup
const AUTH_STATE_DIR = path.join(__dirname, '../../.auth');

/**
 * Get the auth state file path for a user
 */
function getAuthStatePath(user: TestUser): string {
  const safeEmail = user.email.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(AUTH_STATE_DIR, `${safeEmail}.json`);
}

/**
 * Check if auth state exists for a user
 */
function hasAuthState(user: TestUser): boolean {
  const statePath = getAuthStatePath(user);
  return fs.existsSync(statePath);
}

// Detect live environment for timeout adjustment
function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

/**
 * Login helper - uses saved auth state when available, falls back to UI login
 */
async function loginAs(page: Page, context: BrowserContext, user: TestUser): Promise<void> {
  const statePath = getAuthStatePath(user);
  
  // Try to use saved auth state first (much faster, no Firebase quota usage)
  if (fs.existsSync(statePath)) {
    try {
      // Load the storage state into the context
      const storageState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      
      // Apply cookies
      if (storageState.cookies?.length) {
        await context.addCookies(storageState.cookies);
      }
      
      // Apply localStorage by navigating and setting it
      await page.goto('/');
      
      if (storageState.origins?.length) {
        for (const origin of storageState.origins) {
          if (origin.localStorage?.length) {
            await page.evaluate((items: { name: string; value: string }[]) => {
              for (const item of items) {
                localStorage.setItem(item.name, item.value);
              }
            }, origin.localStorage);
          }
        }
      }
      
      // Reload to apply auth state
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      
      // Check if we're authenticated by waiting for redirect or checking for auth elements
      // Give it a moment to process the auth state
      await page.waitForTimeout(1000);
      
      // Try navigating to discover to verify auth
      await page.goto('/discover');
      
      // Wait for either the discover page content or redirect to home
      try {
        await page.waitForURL(/\/(discover|messages|settings|favorites)/, { timeout: 10000 });
        // Auth state worked!
        return;
      } catch {
        // Auth state didn't work, fall through to UI login
        console.log(`Auth state expired for ${user.email}, falling back to UI login`);
      }
    } catch (error) {
      console.log(`Failed to load auth state for ${user.email}:`, error);
    }
  }
  
  // Fallback: UI login (uses Firebase auth quota)
  await loginViaUI(page, user);
}

/**
 * Login via UI - performs a login through the UI
 */
async function loginViaUI(page: Page, user: TestUser, retryCount = 0, isQuotaRetry = false): Promise<void> {
  const isLive = isLiveEnvironment();
  const loginTimeout = isLive ? 45000 : 15000;
  // More retries for quota errors (they often clear after a wait)
  const maxRetries = isQuotaRetry ? 5 : (isLive ? 2 : 1);
  
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
  } catch (error) {
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
      const waitTime = isQuotaError ? 10000 * (retryCount + 1) : 2000;
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
  // Pre-created users (for data access in tests)
  alice: TestUser;
  bob: TestUser;
  
  // Login helpers
  loginAsAlice: () => Promise<void>;
  loginAsBob: () => Promise<void>;
  loginAs: (user: TestUser) => Promise<void>;
}>({
  // User data fixtures
  alice: async ({}, use) => {
    await use(TEST_USERS.alice);
  },

  bob: async ({}, use) => {
    await use(TEST_USERS.bob);
  },

  // Login as Alice (primary female user)
  loginAsAlice: async ({ page, context }, use) => {
    await use(async () => {
      await loginAs(page, context, TEST_USERS.alice);
    });
  },

  // Login as Bob (primary male user)
  loginAsBob: async ({ page, context }, use) => {
    await use(async () => {
      await loginAs(page, context, TEST_USERS.bob);
    });
  },

  // Generic login - use for any user
  loginAs: async ({ page, context }, use) => {
    await use(async (user: TestUser) => {
      await loginAs(page, context, user);
    });
  },
});

export { expect };
export { TEST_USERS, DISCOVER_TEST_USERS, getAllTestUsers };
export type { TestUser };
