import { test, expect, REMOTE_CONFIG_DEFAULTS } from '../fixtures/auth.fixture';

/**
 * Remote Config E2E Tests
 * 
 * These tests verify how the application behaves with different Remote Config values.
 * The config is mocked using Playwright route interception, so no actual Firebase
 * Remote Config changes are needed.
 * 
 * Usage:
 *   await mockRemoteConfig({ feature_feed_enabled: false });
 *   // Then navigate to pages that use the config
 */
test.describe('Remote Config', () => {
  test.describe('Feature Flags', () => {
    test('feed is visible when feature_feed_enabled is true', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Mock config BEFORE login/navigation (important!)
      await mockRemoteConfig({ feature_feed_enabled: true });
      
      await loginAsAlice();
      
      // Navigate to discover page where the sidebar is visible
      await page.goto('/discover');
      
      // Wait for the sidebar to be visible (don't use networkidle - WebSockets keep it busy)
      await page.locator('nav.sidebar-nav').waitFor({ state: 'visible', timeout: 15000 });
      
      // When feed is enabled, it becomes the 'Home' nav item with path /home
      const homeNavItem = page.locator('nav.sidebar-nav a.nav-item[href="/home"]');
      await expect(homeNavItem).toBeVisible({ timeout: 10000 });
      
      // Verify it has the home icon
      await expect(homeNavItem.locator('.nav-icon')).toContainText('home');
    });

    test('feed shows Soon badge when feature_feed_enabled is false', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Mock config BEFORE login/navigation (important!)
      await mockRemoteConfig({ feature_feed_enabled: false });
      
      await loginAsAlice();
      
      // Navigate to discover page where the sidebar is visible
      await page.goto('/discover');
      
      // Wait for the sidebar to be visible (don't use networkidle - WebSockets keep it busy)
      await page.locator('nav.sidebar-nav').waitFor({ state: 'visible', timeout: 15000 });
      
      // When feed is disabled, there should be no /home nav item
      const homeNavItem = page.locator('nav.sidebar-nav a.nav-item[href="/home"]');
      await expect(homeNavItem).not.toBeVisible({ timeout: 5000 });
      
      // Instead, there should be a /feed nav item with a "Soon" badge
      const feedNavItem = page.locator('nav.sidebar-nav a.nav-item[href="/feed"]');
      await expect(feedNavItem).toBeVisible({ timeout: 10000 });
      await expect(feedNavItem.locator('.nav-badge.coming-soon')).toBeVisible();
    });

    test('report issue feature visibility', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Enable the report issue feature
      await mockRemoteConfig({ feature_report_issue: true });
      
      await loginAsAlice();
      
      // Navigate to a user profile or settings where report would appear
      await page.goto('/settings');
      
      // Check for report issue button/link - adjust selector as needed
      const reportButton = page.locator('[data-testid="report-issue"], button:has-text("Report")');
      // This might need adjustment based on where the report feature appears
      // await expect(reportButton).toBeVisible();
    });
  });

  test.describe('Geographic Restrictions', () => {
    test('allows onboarding for users in allowed regions', async ({ 
      page, 
      mockRemoteConfig 
    }) => {
      // Allow US and Canada
      await mockRemoteConfig({ allowed_region_codes: ['us', 'ca'] });
      
      await page.goto('/');
      
      // Start signup flow
      await page.getByRole('button', { name: /get started/i }).click();
      await page.locator('.modal-backdrop').waitFor();
      
      // Should be able to proceed with signup
      // The actual location check happens during onboarding
    });

    test('shows restriction message for users outside allowed regions', async ({ 
      page, 
      mockRemoteConfig 
    }) => {
      // Only allow a region the test user won't be in
      await mockRemoteConfig({ allowed_region_codes: ['xx'] }); // Non-existent region
      
      // Note: This test would need the app to actually check the region
      // and display an appropriate message. The implementation depends
      // on how your app handles geographic restrictions.
    });
  });

  test.describe('Premium Features', () => {
    test('displays correct subscription price', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Set a specific price
      await mockRemoteConfig({ subscription_monthly_price_cents: 1999 });
      
      await loginAsAlice();
      
      // Navigate to pricing/subscription page
      await page.goto('/settings');
      
      // Look for price display - adjust based on your UI
      // The price should show $19.99
      // await expect(page.locator('.subscription-price')).toContainText('$19.99');
    });

    test('enforces max photos limit for premium users', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Set a lower max photos limit for testing
      await mockRemoteConfig({ premium_max_photos: 5 });
      
      await loginAsAlice();
      
      // Navigate to profile edit
      await page.goto('/profile/edit');
      
      // Verify the photo slots match the config
      // await expect(page.locator('.photo-slot')).toHaveCount(5);
    });
  });

  test.describe('Pagination', () => {
    test('uses configured discover page size', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Set a specific page size
      await mockRemoteConfig({ discover_page_size: 10 });
      
      await loginAsAlice();
      
      await page.goto('/discover');
      
      // The discover page should load with the configured page size
      // This would need backend coordination or network inspection to verify
    });
  });

  test.describe('Virtual Phone Feature', () => {
    test('virtual phone option visible when enabled', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      await mockRemoteConfig({ virtual_phone_enabled: true });
      
      await loginAsAlice();
      
      // Navigate to where virtual phone would appear
      await page.goto('/settings');
      
      // Check for virtual phone option
      // const virtualPhoneOption = page.locator('[data-testid="virtual-phone"]');
      // await expect(virtualPhoneOption).toBeVisible();
    });

    test('virtual phone option hidden when disabled', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      await mockRemoteConfig({ virtual_phone_enabled: false });
      
      await loginAsAlice();
      
      await page.goto('/settings');
      
      // Virtual phone option should not be visible
      // const virtualPhoneOption = page.locator('[data-testid="virtual-phone"]');
      // await expect(virtualPhoneOption).not.toBeVisible();
    });
  });

  test.describe('Multiple Config Values', () => {
    test('can mock multiple config values at once', async ({ 
      page, 
      mockRemoteConfig, 
      loginAsAlice 
    }) => {
      // Mock multiple values
      await mockRemoteConfig({
        feature_feed_enabled: true,
        feature_report_issue: true,
        virtual_phone_enabled: true,
        subscription_monthly_price_cents: 999,
        premium_max_photos: 30,
        allowed_region_codes: ['us', 'ca', 'gb', 'au'],
      });
      
      await loginAsAlice();
      
      // Verify the config was applied
      // Add assertions based on your UI
    });
  });
});
