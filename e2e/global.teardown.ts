import { chromium, Page } from '@playwright/test';
import { getAllTestUsers, TestUser } from './tests/fixtures/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';

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
 * Global teardown - deletes all test users
 */
async function globalTeardown() {
  console.log('\n🧹 Global Teardown: Cleaning up test users...\n');
  
  const browser = await chromium.launch();
  const users = getAllTestUsers();
  
  for (const user of users) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
      console.log(`  Deleting user: ${user.email}...`);
      const loggedIn = await loginAs(page, user);
      
      if (loggedIn) {
        await deleteAccount(page);
        console.log(`    ✓ Account deleted`);
      } else {
        console.log(`    ⏭ Could not login (user may not exist)`);
      }
    } catch (error) {
      console.warn(`    ⚠ Failed to delete ${user.email}:`, error);
      // Don't throw - continue with other users
    } finally {
      await context.close();
    }
  }
  
  await browser.close();
  console.log('\n✅ Global Teardown complete: All test users cleaned up\n');
}

export default globalTeardown;
