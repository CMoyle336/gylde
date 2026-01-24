import { test as base, expect, Page, TestInfo } from '@playwright/test';
import { TEST_USERS, DISCOVER_TEST_USERS, TestUser, getAllTestUsers, AUTH_EMULATOR_URL } from './test-users';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ID = 'gylde-dba55';

/**
 * Generate a unique user for a test based on a template user
 * This ensures each test has its own isolated user
 */
function generateUniqueUser(template: TestUser, testInfo: TestInfo): TestUser {
  // Create unique suffix from worker index and retry count
  const uniqueId = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
  
  return {
    ...template,
    id: `${template.id}-${uniqueId}`,
    email: `${template.id}-${uniqueId}@e2e.test`,
    displayName: `${template.displayName} ${uniqueId}`,
    storageStatePath: `.auth/${template.id}-${uniqueId}.json`,
  };
}

/**
 * Signup via UI - creates a new user through the signup flow
 */
async function signupAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  
  // Open auth modal
  await page.getByRole('button', { name: /get started/i }).click();
  await page.locator('.modal-backdrop').waitFor();
  
  // Should already be in signup mode by default, but ensure we're there
  const authSwitch = page.locator('.auth-switch button');
  const switchText = await authSwitch.textContent();
  if (switchText?.toLowerCase().includes('sign up')) {
    // We're in login mode, switch to signup
    await authSwitch.click();
  }
  
  // Fill signup form - all required fields
  await page.getByRole('textbox', { name: 'Display Name' }).fill(user.displayName);
  await page.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(user.password);
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(user.password);
  
  // Submit
  await page.locator('.submit-btn').click();
  
  // Wait for redirect to onboarding
  await page.waitForURL('**/onboarding', { timeout: 15000 });
}

/**
 * Login helper - performs a quick login for a user (use when user already exists and onboarded)
 */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  
  // Open auth modal
  await page.getByRole('button', { name: /get started/i }).click();
  await page.locator('.modal-backdrop').waitFor();
  
  // Switch to login mode
  await page.locator('.auth-switch button').click();
  
  // Fill credentials
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  
  // Submit
  await page.locator('.submit-btn').click();
  
  // Wait for redirect to authenticated page
  await page.waitForURL(/\/(discover|messages|settings|onboarding)/, { timeout: 10000 });
}

/**
 * Full auth flow: signup + complete onboarding
 * Use this for fully parallel tests where each test gets a unique user
 */
async function signupAndOnboard(page: Page, user: TestUser): Promise<void> {
  await signupAs(page, user);
  await completeOnboarding(page, user);
}

/**
 * Complete onboarding for a user
 */
async function completeOnboarding(page: Page, user: TestUser): Promise<void> {
  // Check if we're on onboarding
  if (!page.url().includes('/onboarding')) {
    return;
  }

  // Step 1: Eligibility - Birthday and Location
  await page.locator('.datepicker-toggle').click();
  await page.locator('.mat-calendar').waitFor();

  const birthYear = user.birthDate.getFullYear();
  const birthMonth = user.birthDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();

  await page.getByRole('button', { name: String(birthYear) }).click();
  await page.getByRole('button', { name: birthMonth }).click();
  await page.getByRole('gridcell', { name: String(user.birthDate.getDate()) }).click();

  // Wait for location field
  await page.locator('input[role="combobox"]').waitFor();
  await page.locator('input[role="combobox"]').fill(user.city);
  await page.waitForTimeout(1000);
  await page.locator('.suggestion-item').first().click();
  await page.locator('.btn-next').click();

  // Step 2: Identity
  await page.locator(`label[for="gender-${user.gender}"]`).click();
  for (const interest of user.interestedIn) {
    await page.locator(`label[for="interested-${interest}"]`).click();
  }
  await page.locator('.btn-next').click();

  // Step 3: Intent
  await page.locator('.options-grid .option-chip').first().click();
  await page.locator('.btn-next').click();

  // Step 4: Age Range (optional, just click next)
  await page.locator('.btn-next').click();

  // Step 5: Prompts
  await page.locator('#tagline').fill(user.tagline);
  await page.locator('#ideal-relationship').fill('Someone who values honesty.');
  await page.locator('.btn-next').click();

  // Step 6: Photos
  const testImagePath = path.join(__dirname, user.testImage);
  if (fs.existsSync(testImagePath)) {
    await page.locator('.photo-upload-btn').first().click();
    await page.waitForTimeout(100);
    await page.locator('.photo-slot.primary input[type="file"]').setInputFiles(testImagePath);

    // Wait for upload to complete
    await page.locator('.photo-slot.primary .photo-preview').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  // Wait for Finish button and click
  await page.locator('.btn-next:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('.btn-next').click();

  // Wait for redirect to discover
  await page.waitForURL('**/discover', { timeout: 15000 });
}

/**
 * Extended test with auth helpers
 * 
 * For fully parallel execution, each test gets a UNIQUE user based on templates.
 * This avoids race conditions where multiple tests try to create/login the same user.
 * 
 * Usage:
 *   - loginAsAlice: Creates a unique "alice-like" user, signs up, completes onboarding
 *   - loginAsBob: Creates a unique "bob-like" user, signs up, completes onboarding
 *   - currentUser: Returns the unique user created for this test (after loginAsAlice/Bob)
 */
export const test = base.extend<{
  // Template users (for reference, not for direct use in parallel tests)
  aliceTemplate: TestUser;
  bobTemplate: TestUser;
  
  // Current unique user for this test (set after loginAsAlice or loginAsBob)
  currentUser: TestUser | null;
  
  // Auth helpers - each creates a unique user for this test
  loginAsAlice: () => Promise<TestUser>;
  loginAsBob: () => Promise<TestUser>;
  
  // Raw helpers (use with caution in parallel tests)
  loginAs: (user: TestUser) => Promise<void>;
  signupAndOnboardAs: (user: TestUser) => Promise<void>;
  completeOnboardingAs: (user: TestUser) => Promise<void>;
}>({
  aliceTemplate: async ({}, use) => {
    await use(TEST_USERS.alice);
  },

  bobTemplate: async ({}, use) => {
    await use(TEST_USERS.bob);
  },

  currentUser: [null, { option: true }],

  // loginAsAlice creates a unique alice-like user for this test
  loginAsAlice: async ({ page }, use, testInfo) => {
    let user: TestUser | null = null;
    
    await use(async () => {
      user = generateUniqueUser(TEST_USERS.alice, testInfo);
      await signupAndOnboard(page, user);
      return user;
    });
  },

  // loginAsBob creates a unique bob-like user for this test
  loginAsBob: async ({ page }, use, testInfo) => {
    let user: TestUser | null = null;
    
    await use(async () => {
      user = generateUniqueUser(TEST_USERS.bob, testInfo);
      await signupAndOnboard(page, user);
      return user;
    });
  },

  // Raw login - only use when you know user exists and is onboarded
  loginAs: async ({ page }, use) => {
    await use(async (user: TestUser) => {
      await loginAs(page, user);
    });
  },

  // Full signup + onboarding flow
  signupAndOnboardAs: async ({ page }, use) => {
    await use(async (user: TestUser) => {
      await signupAndOnboard(page, user);
    });
  },

  completeOnboardingAs: async ({ page }, use) => {
    await use(async (user: TestUser) => {
      await completeOnboarding(page, user);
    });
  },
});

export { expect };
export { TEST_USERS, DISCOVER_TEST_USERS, getAllTestUsers, generateUniqueUser };
