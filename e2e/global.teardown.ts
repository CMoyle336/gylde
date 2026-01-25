import { chromium, Browser, Page } from '@playwright/test';
import { getAllTestUsers, TestUser } from './tests/fixtures/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';

// Maximum number of users to delete in parallel
const MAX_PARALLEL_USERS = 10;

/**
 * Login as a user
 */
async function loginAs(page: Page, user: TestUser): Promise<boolean> {
  await page.goto(BASE_URL);
  
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
  
  // Wait for redirect
  try {
    await page.waitForURL(/\/(discover|messages|settings|onboarding)/, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete account - navigates to settings and deletes the user's account
 */
async function deleteAccount(page: Page): Promise<void> {
  // Navigate to settings
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForURL('**/settings', { timeout: 10000 });
  
  // Wait for page to load
  await page.waitForTimeout(1000);
  
  // Scroll to bottom to find delete button
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  
  // Click "Delete account" button to open dialog
  const deleteBtn = page.getByRole('button', { name: /delete account/i }).first();
  await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
  await deleteBtn.click();
  
  // Wait for confirmation dialog to appear (the dialog has class "dialog delete-dialog")
  await page.locator('.dialog.delete-dialog').waitFor({ state: 'visible', timeout: 10000 });
  
  // Type the confirmation text "DELETE MY ACCOUNT"
  const confirmInput = page.locator('.delete-dialog input');
  await confirmInput.waitFor({ state: 'visible', timeout: 5000 });
  await confirmInput.fill('DELETE MY ACCOUNT');
  
  // Wait a moment for the button to enable
  await page.waitForTimeout(300);
  
  // Click the confirm delete button (should now be enabled)
  const confirmBtn = page.locator('.delete-dialog button[color="warn"]').last();
  await confirmBtn.click();
  
  // Wait for redirect to home
  await page.waitForURL('**/', { timeout: 15000 });
}

/**
 * Delete a single user
 */
async function deleteUser(browser: Browser, user: TestUser): Promise<{ email: string; success: boolean; error?: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`  [${user.displayName}] Logging in...`);
    const loggedIn = await loginAs(page, user);
    
    if (loggedIn) {
      console.log(`  [${user.displayName}] Deleting account...`);
      await deleteAccount(page);
      console.log(`  [${user.displayName}] ✓ Deleted`);
      return { email: user.email, success: true };
    } else {
      console.log(`  [${user.displayName}] ⏭ Not found (may already be deleted)`);
      return { email: user.email, success: true }; // Consider this success
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`  [${user.displayName}] ⚠ Failed: ${errorMsg}`);
    return { email: user.email, success: false, error: errorMsg };
  } finally {
    await context.close();
  }
}

/**
 * Process items in parallel with concurrency limit
 */
async function processInParallel<T, R>(
  items: T[],
  maxConcurrent: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });
    
    executing.push(promise);
    
    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const p = executing[i];
        const isSettled = await Promise.race([
          p.then(() => true).catch(() => true),
          Promise.resolve(false)
        ]);
        if (isSettled) {
          executing.splice(i, 1);
        }
      }
    }
  }
  
  // Wait for all remaining promises
  await Promise.all(executing);
  
  return results;
}

/**
 * Global teardown - deletes all test users in parallel
 */
async function globalTeardown() {
  console.log('\n🧹 Global Teardown: Cleaning up test users...\n');
  console.log(`   Running with up to ${MAX_PARALLEL_USERS} parallel operations\n`);
  
  const browser = await chromium.launch();
  const users = getAllTestUsers();
  
  const startTime = Date.now();
  
  // Process users in parallel with concurrency limit
  const results = await processInParallel(
    users,
    MAX_PARALLEL_USERS,
    (user) => deleteUser(browser, user)
  );
  
  await browser.close();
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Global Teardown complete in ${elapsed}s`);
  console.log(`   ${succeeded}/${results.length} users cleaned up`);
  
  if (failed.length > 0) {
    console.log(`   Failed to delete: ${failed.map(f => f.email).join(', ')}`);
    // Don't throw - teardown failures shouldn't fail the test run
  }
  
  console.log('');
}

export default globalTeardown;
