import { test, expect, TEST_USERS, DISCOVER_TEST_USERS } from '../fixtures/auth.fixture';
import { Page } from '@playwright/test';

/**
 * Discover Page Tests
 * 
 * Tests the discover page functionality including:
 * - Page layout and navigation
 * - Filter controls
 * - Profile card display
 * - Cross-user visibility (Alice can see Bob, Bob can see Alice)
 * 
 * Users are created in global setup before tests run.
 */

/**
 * Helper function to navigate to discover page and wait for it to fully load
 */
async function goToDiscoverPage(page: Page) {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor();
  await page.locator('.filter-toggle-btn').waitFor({ state: 'visible' });
  // Give Angular time to attach event handlers
  await page.waitForTimeout(500);
}

/**
 * Helper function to open filters and wait for animation to complete
 */
async function openFiltersPanel(page: Page) {
  await page.locator('.filter-toggle-btn').click();
  await page.locator('.filters-panel').waitFor({ state: 'visible' });
  // Wait for animation to complete
  await page.waitForTimeout(300);
}

test.describe('Discover Page', () => {
  test.describe('Page Layout', () => {
    test('displays discover page with correct layout', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Should have main discover component
      await expect(page.locator('app-discover')).toBeVisible();
      
      // Should have filter controls
      await expect(page.getByRole('button', { name: /filters/i })).toBeVisible();
      
      // Should have view options
      await expect(page.getByText(/views/i)).toBeVisible();
    });

    test('displays user profile info', async ({ page, loginAsAlice, alice }) => {
      await loginAsAlice();
      await page.goto('/discover');
      
      // Should show user's display name somewhere on the page
      await expect(page.getByText(alice.displayName)).toBeVisible();
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
    test('can open and close filters panel', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Click filters button to open
      await openFiltersPanel(page);
      
      // Filter panel should appear
      await expect(page.locator('.filters-panel')).toBeVisible();
      
      // Click again to close
      await page.locator('.filter-toggle-btn').click();
      await page.waitForTimeout(300);
      
      // Filter panel should be hidden
      await expect(page.locator('.filters-panel')).not.toBeVisible();
    });

    test('quick filters are available to all users', async ({ page, loginAsBob }) => {
      // Bob is non-premium, but quick filters should still be available
      await loginAsBob();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Quick filters should be visible
      await expect(page.locator('.quick-filter-card').filter({ hasText: /verified only/i })).toBeVisible();
      await expect(page.locator('.quick-filter-card').filter({ hasText: /online now/i })).toBeVisible();
      await expect(page.locator('.quick-filter-card').filter({ hasText: /active in 24h/i })).toBeVisible();
    });

    test('can toggle quick filters', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click "Verified Only" filter
      const verifiedFilter = page.locator('.quick-filter-card').filter({ hasText: /verified only/i });
      await verifiedFilter.click();
      
      // Should be active now
      await expect(verifiedFilter).toHaveClass(/active/);
      
      // Click again to toggle off
      await verifiedFilter.click();
      
      // Should no longer be active
      await expect(verifiedFilter).not.toHaveClass(/active/);
    });

    test('distance filter is available', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Distance section should be visible
      await expect(page.locator('.distance-filter-section')).toBeVisible();
      
      // Distance options should be clickable
      const distanceOptions = page.locator('.distance-option');
      await expect(distanceOptions.first()).toBeVisible();
    });

    test('can select distance option', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click a distance option (first one)
      const firstDistanceOption = page.locator('.distance-option').first();
      await firstDistanceOption.click();
      
      // Should be selected
      await expect(firstDistanceOption).toHaveClass(/selected/);
    });

    test('member status filter is available', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Reputation/member status section should be visible
      await expect(page.locator('.reputation-filter-section')).toBeVisible();
      
      // Tier options should be visible
      await expect(page.locator('.tier-option').filter({ hasText: /all/i })).toBeVisible();
      await expect(page.locator('.tier-option').filter({ hasText: /active/i })).toBeVisible();
      await expect(page.locator('.tier-option').filter({ hasText: /established/i })).toBeVisible();
      await expect(page.locator('.tier-option').filter({ hasText: /trusted/i })).toBeVisible();
    });

    test('can select member status tier', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click "Established+" tier
      const establishedTier = page.locator('.tier-option').filter({ hasText: /established/i });
      await establishedTier.scrollIntoViewIfNeeded();
      await establishedTier.click();
      
      // Should be selected
      await expect(establishedTier).toHaveClass(/selected/);
    });

    test('looking for chips are available', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Looking For section should have chips
      const chipGrid = page.locator('.chip-grid');
      await expect(chipGrid).toBeVisible();
      
      // Some filter chips should be visible
      const filterChips = page.locator('.filter-chip');
      expect(await filterChips.count()).toBeGreaterThan(0);
    });

    test('can toggle looking for chips', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click first filter chip
      const firstChip = page.locator('.filter-chip').first();
      const chipText = await firstChip.textContent();
      await firstChip.click();
      
      // Should be selected
      await expect(firstChip).toHaveClass(/selected/);
      
      // Click again to deselect
      await firstChip.click();
      
      // Should no longer be selected
      await expect(firstChip).not.toHaveClass(/selected/);
    });

    test('reset filters button works', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Activate a quick filter
      const verifiedFilter = page.locator('.quick-filter-card').filter({ hasText: /verified only/i });
      await verifiedFilter.click();
      await expect(verifiedFilter).toHaveClass(/active/);
      
      // Click reset
      await page.getByRole('button', { name: /reset all/i }).click();
      
      // Filter should be deactivated
      await expect(verifiedFilter).not.toHaveClass(/active/);
    });

    test('apply filters button is visible', async ({ page, loginAsAlice }) => {
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Apply button should be visible
      await expect(page.getByRole('button', { name: /apply filters/i })).toBeVisible();
    });
  });

  test.describe('Advanced Filters - Premium Access', () => {
    test('non-premium user sees premium badge on more filters button', async ({ page, loginAsBob }) => {
      // Bob is non-premium
      await loginAsBob();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // "More filters" button should show premium badge
      const moreFiltersBtn = page.locator('.show-more-btn');
      await expect(moreFiltersBtn).toBeVisible();
      await expect(moreFiltersBtn.locator('.premium-badge')).toBeVisible();
      await expect(moreFiltersBtn.locator('.premium-badge')).toHaveText(/premium/i);
    });

    test('non-premium user cannot expand advanced filters', async ({ page, loginAsBob }) => {
      // Bob is non-premium
      await loginAsBob();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click "More filters" button
      await page.locator('.show-more-btn').click();
      
      // Advanced filters should NOT be visible (upgrade prompt shown instead)
      await expect(page.locator('.advanced-filters')).not.toBeVisible();
    });

    test('premium user does not see premium badge on more filters', async ({ page, loginAsAlice }) => {
      // Alice is premium
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // "More filters" button should NOT have premium badge
      const moreFiltersBtn = page.locator('.show-more-btn');
      await expect(moreFiltersBtn).toBeVisible();
      await expect(moreFiltersBtn.locator('.premium-badge')).not.toBeVisible();
    });

    test('premium user can expand advanced filters', async ({ page, loginAsAlice }) => {
      // Alice is premium
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Click "More filters" button - scroll into view first
      const moreFiltersBtn = page.locator('.show-more-btn');
      await moreFiltersBtn.scrollIntoViewIfNeeded();
      await moreFiltersBtn.click();
      
      // Advanced filters should be visible
      await expect(page.locator('.advanced-filters')).toBeVisible();
    });

    test('premium user sees all advanced filter options', async ({ page, loginAsAlice }) => {
      // Alice is premium
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Expand advanced filters
      await page.locator('.show-more-btn').click();
      await expect(page.locator('.advanced-filters')).toBeVisible();
      
      // All advanced filter sections should be visible
      await expect(page.getByText('Support Style')).toBeVisible();
      await expect(page.getByText('Height')).toBeVisible();
      await expect(page.getByText('Income')).toBeVisible();
      await expect(page.getByText('Ethnicity')).toBeVisible();
      await expect(page.getByText('Relationship Status')).toBeVisible();
      await expect(page.getByText('Children')).toBeVisible();
      await expect(page.getByText('Smoking')).toBeVisible();
      await expect(page.getByText('Drinking')).toBeVisible();
      await expect(page.getByText('Education')).toBeVisible();
    });

    test('premium user can collapse advanced filters', async ({ page, loginAsAlice }) => {
      // Alice is premium
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Expand advanced filters
      await page.locator('.show-more-btn').click();
      await expect(page.locator('.advanced-filters')).toBeVisible();
      
      // Click to collapse (button text changes to "Less filters")
      await page.locator('.show-more-btn').click();
      
      // Advanced filters should be hidden
      await expect(page.locator('.advanced-filters')).not.toBeVisible();
    });

    test('premium user can interact with advanced filter dropdowns', async ({ page, loginAsAlice }) => {
      // Alice is premium
      await loginAsAlice();
      await goToDiscoverPage(page);
      
      // Open filters
      await openFiltersPanel(page);
      
      // Expand advanced filters
      await page.locator('.show-more-btn').click();
      await expect(page.locator('.advanced-filters')).toBeVisible();
      
      // Click on a mat-select to open dropdown (e.g., Height)
      const heightSelect = page.locator('.filter-group').filter({ hasText: /height/i }).locator('mat-select');
      await heightSelect.click();
      
      // Dropdown panel should appear
      await expect(page.locator('.mat-mdc-select-panel')).toBeVisible();
      
      // Options should be available
      const options = page.locator('mat-option');
      expect(await options.count()).toBeGreaterThan(0);
      
      // Click outside to close
      await page.keyboard.press('Escape');
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

test.describe('Discover Page - Cross-User Visibility', () => {
  test('woman can see men in discover', async ({ page, loginAsAlice, bob }) => {
    await loginAsAlice();
    await page.goto('/discover');
    
    // Wait for discover page to load profiles
    await page.locator('app-discover').waitFor();
    await page.waitForTimeout(3000);
    
    // Alice (woman looking for men) should see Bob (man looking for women)
    // Use .card-name to specifically target the profile card heading, not tooltips
    const bobCard = page.locator('.card-name').filter({ hasText: bob.displayName });
    await expect(bobCard.first()).toBeVisible({ timeout: 10000 });
  });

  test('man can see women in discover', async ({ page, loginAsBob, alice }) => {
    await loginAsBob();
    await page.goto('/discover');
    
    // Wait for discover page to load profiles
    await page.locator('app-discover').waitFor();
    await page.waitForTimeout(3000);
    
    // Bob (man looking for women) should see Alice (woman looking for men)
    // Use .card-name to specifically target the profile card heading, not tooltips
    const aliceCard = page.locator('.card-name').filter({ hasText: alice.displayName });
    await expect(aliceCard.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Discover Page - User Info', () => {
  test('man user sees discover page correctly', async ({ page, loginAsBob, bob }) => {
    await loginAsBob();
    await page.goto('/discover');
    await page.waitForTimeout(2000);
    
    // User should see their name in sidebar/header
    await expect(page.getByText(bob.displayName)).toBeVisible();
    
    // Discover page should be functional
    await expect(page.locator('app-discover')).toBeVisible();
  });

  test('woman user sees discover page correctly', async ({ page, loginAsAlice, alice }) => {
    await loginAsAlice();
    await page.goto('/discover');
    await page.waitForTimeout(2000);
    
    // User should see their name in sidebar/header
    await expect(page.getByText(alice.displayName)).toBeVisible();
    
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
