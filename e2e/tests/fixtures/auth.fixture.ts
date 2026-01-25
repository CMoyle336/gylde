import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { TEST_USERS, DISCOVER_TEST_USERS, TestUser, getAllTestUsers } from './test-users';
import dotenv from 'dotenv';
import path from 'path';

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
 * Login helper - performs UI login with quota-aware retry logic
 * Note: Firebase stores auth in IndexedDB which Playwright can't persist,
 * so we always use UI login but with careful rate limiting.
 */
async function loginAs(page: Page, context: BrowserContext, user: TestUser): Promise<void> {
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
