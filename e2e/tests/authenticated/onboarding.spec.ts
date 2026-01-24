import { test, expect } from '../fixtures/auth.fixture';

/**
 * Authenticated User Access Tests
 * 
 * These tests verify that logged-in users can access authenticated routes.
 * Users are created in global setup before tests run.
 */

test.describe('Authenticated User Access', () => {
  test('can access discover page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/discover');
    
    await expect(page).toHaveURL(/\/discover/);
    await expect(page.locator('app-discover')).toBeVisible();
  });

  test('can access settings page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/settings');
    
    await expect(page).toHaveURL(/\/settings/);
  });

  test('can navigate to messages', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/messages');
    
    await expect(page).toHaveURL(/\/messages/);
  });

  test('is redirected away from onboarding (already completed)', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/onboarding');
    
    // Completed users should be redirected
    await expect(page).not.toHaveURL(/\/onboarding$/);
  });
});

test.describe('Unauthenticated Access', () => {
  test('unauthenticated users cannot access discover', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto('/discover');
    
    // Should be redirected away
    await expect(page).not.toHaveURL(/\/discover$/);
    
    await context.close();
  });
});
