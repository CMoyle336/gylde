import { test as base, expect, Page } from '@playwright/test';
import { TEST_USERS, DISCOVER_TEST_USERS, TestUser, getAllTestUsers } from './test-users';

/**
 * Login helper - performs a quick login for a user
 */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  
  // Open auth modal
  await page.getByRole('button', { name: /get started/i }).click();
  await page.locator('.modal-backdrop').waitFor();
  
  // Switch to login mode (modal opens in signup mode by default)
  await page.locator('.auth-switch button').click();
  
  // Fill credentials
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  
  // Submit
  await page.locator('.submit-btn').click();
  
  // Wait for redirect to authenticated page
  await page.waitForURL(/\/(discover|messages|settings|favorites)/, { timeout: 15000 });
}

/**
 * Extended test with auth helpers
 * 
 * Users are created in global setup before tests run.
 * Tests can login as any of the pre-created users.
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
  loginAsAlice: async ({ page }, use) => {
    await use(async () => {
      await loginAs(page, TEST_USERS.alice);
    });
  },

  // Login as Bob (primary male user)
  loginAsBob: async ({ page }, use) => {
    await use(async () => {
      await loginAs(page, TEST_USERS.bob);
    });
  },

  // Generic login - use for any user
  loginAs: async ({ page }, use) => {
    await use(async (user: TestUser) => {
      await loginAs(page, user);
    });
  },
});

export { expect };
export { TEST_USERS, DISCOVER_TEST_USERS, getAllTestUsers };
export type { TestUser };
