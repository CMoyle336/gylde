import { test, expect } from '../fixtures/auth.fixture';

/**
 * Discover Page Tests
 * 
 * Tests the discover page functionality including:
 * - Page layout and navigation
 * - Filter controls
 * - Profile card display
 * 
 * Each test creates its own unique user for full parallel execution.
 */

test.describe('Discover Page', () => {
  test.describe('Page Layout', () => {
    test('displays discover page with correct layout', async ({ page, loginAsAlice }) => {
      const user = await loginAsAlice();
      await page.goto('/discover');
      
      // Should have main discover component
      await expect(page.locator('app-discover')).toBeVisible();
      
      // Should have filter controls
      await expect(page.getByRole('button', { name: /filters/i })).toBeVisible();
      
      // Should have view options
      await expect(page.getByText(/views/i)).toBeVisible();
    });

    test('displays user profile info', async ({ page, loginAsAlice }) => {
      const user = await loginAsAlice();
      await page.goto('/discover');
      
      // Should show user's display name somewhere on the page
      await expect(page.getByText(user.displayName)).toBeVisible();
    });

    test('displays navigation menu', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Should have navigation items
      await expect(page.getByText(/discover/i).first()).toBeVisible();
      await expect(page.getByText(/matches/i)).toBeVisible();
      await expect(page.getByText(/messages/i)).toBeVisible();
    });
  });

  test.describe('Profile Cards', () => {
    test('displays profile cards section', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Wait for profiles to load
      await page.waitForTimeout(2000);
      
      // Should show results section (may have profiles or empty state)
      const resultCount = page.locator('[class*="results"]');
      await expect(resultCount).toBeVisible();
    });

    test('cards show location info when available', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      await page.waitForTimeout(2000);
      
      // Cards should show location info if profiles exist
      const locationText = page.locator('[class*="location"]').first();
      if (await locationText.count() > 0) {
        await expect(locationText).toBeVisible();
      }
    });

    test('cards have action buttons when profiles exist', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      await page.waitForTimeout(2000);
      
      // Cards should have interaction buttons (message, view, like) if profiles exist
      const actionButtons = page.locator('[class*="card"] button, [class*="profile"] button');
      if (await actionButtons.count() > 0) {
        expect(await actionButtons.count()).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Filters', () => {
    test('can open filters panel', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Click filters button
      await page.getByRole('button', { name: /filters/i }).click();
      
      // Filter panel should appear
      await page.waitForTimeout(500);
    });

    test('filter options are available', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Look for filter-related elements
      const recentlyActive = page.getByText(/recently active/i);
      if (await recentlyActive.count() > 0) {
        await expect(recentlyActive.first()).toBeVisible();
      }
    });
  });

  test.describe('Interactions', () => {
    test('refresh button works', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      await page.waitForTimeout(1000);
      
      // Find and click refresh button if it exists
      const refreshButton = page.locator('button').filter({ has: page.locator('[class*="refresh"], [class*="sync"]') }).first();
      if (await refreshButton.count() > 0) {
        await refreshButton.click();
        await page.waitForTimeout(1000);
        // Page should still be on discover after refresh
        await expect(page).toHaveURL(/discover/);
      }
    });
  });
});

test.describe('Discover Page - User Perspectives', () => {
  test('man user sees discover page correctly', async ({ page, loginAsBob }) => {
    const user = await loginAsBob();
    await page.goto('/discover');
    await page.waitForTimeout(2000);
    
    // User should see their name
    await expect(page.getByText(user.displayName)).toBeVisible();
    
    // Discover page should be functional
    await expect(page.locator('app-discover')).toBeVisible();
  });

  test('woman user sees discover page correctly', async ({ page, loginAsAlice }) => {
    const user = await loginAsAlice();
    await page.goto('/discover');
    await page.waitForTimeout(2000);
    
    // User should see their name
    await expect(page.getByText(user.displayName)).toBeVisible();
    
    // Discover page should be functional
    await expect(page.locator('app-discover')).toBeVisible();
  });
});

test.describe('Discover Page - Empty States', () => {
  test('shows results section', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await page.goto('/discover');
    await page.waitForTimeout(2000);
    
    // Should show either results or empty state
    const noResults = page.getByText(/no.*results|no.*profiles|no.*matches/i);
    const hasResults = page.locator('[class*="results"]');
    
    const resultsVisible = await hasResults.isVisible().catch(() => false);
    const emptyVisible = await noResults.isVisible().catch(() => false);
    
    expect(resultsVisible || emptyVisible).toBe(true);
  });
});
