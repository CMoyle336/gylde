import { test, expect } from '../fixtures/auth.fixture';

/**
 * User Interaction Tests
 * 
 * Tests for authenticated user interactions.
 * Each test creates a unique user for full parallel execution.
 */

test.describe('Discover', () => {
  test('can view discover page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/discover');
    
    await expect(page.locator('app-discover')).toBeVisible();
  });
});

test.describe('Messages', () => {
  test('can access messages page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/messages');
    
    await expect(page).toHaveURL(/\/messages/);
  });
});

test.describe('Favorites', () => {
  test('can access favorites page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/favorites');
    
    await expect(page).toHaveURL(/\/favorites/);
  });
});

test.describe('Settings', () => {
  test('can access settings', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/settings');
    
    await expect(page).toHaveURL(/\/settings/);
  });
});
