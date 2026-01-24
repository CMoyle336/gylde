import { test, expect, TEST_USERS } from '../fixtures/auth.fixture';
import { Page } from '@playwright/test';

/**
 * Favorites E2E Tests
 * 
 * Tests for the favorites functionality and related premium features.
 * 
 * Test scenarios:
 * - User A favorites User B
 * - If User B is NOT premium:
 *   - Cannot access 'favorited me' tab (premium-locked)
 *   - Does not see activity record for being favorited
 * - If User B IS premium:
 *   - Sees activity record stating User A favorited them
 *   - Sees User A in 'favorited me' section of matches tab
 */

// Helper to navigate to discover page and wait for it to load
async function goToDiscoverPage(page: Page): Promise<void> {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500); // Wait for Angular to fully initialize
}

// Helper to navigate to matches page and wait for it to load
async function goToMatchesPage(page: Page): Promise<void> {
  await page.goto('/matches');
  await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500); // Wait for Angular to fully initialize
}

// Helper to favorite a user by their display name on the discover page
async function favoriteUserByName(page: Page, displayName: string): Promise<void> {
  // Find the profile card containing the user's name
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  await profileCard.waitFor({ state: 'visible', timeout: 10000 });
  
  // Click the favorite button on this card
  const favoriteBtn = profileCard.locator('.action-btn.favorite');
  await favoriteBtn.waitFor({ state: 'visible' });
  await favoriteBtn.click();
  
  // Wait for the favorited state to be applied
  await expect(profileCard.locator('.action-btn.favorite.favorited')).toBeVisible({ timeout: 5000 });
}

// Helper to check if activity sidebar contains a specific activity
async function checkActivityForFavorite(page: Page, favoritedByName: string): Promise<boolean> {
  // Look for the activity section
  const activitySection = page.locator('.sidebar-activity');
  
  // Check if there's an activity item mentioning the user
  const activityItem = activitySection.locator('.activity-item').filter({
    has: page.locator('.activity-text', { hasText: `${favoritedByName} favorited you` })
  });
  
  return await activityItem.count() > 0;
}

test.describe('Favorites - Non-Premium User (Bob)', () => {
  test.beforeEach(async ({ page, loginAsBob }) => {
    // Login as Bob (non-premium user)
    await loginAsBob();
  });

  test('cannot access favorited-me tab on matches page', async ({ page }) => {
    await goToMatchesPage(page);
    
    // Find the "Favorited Me" tab button
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toBeVisible();
    
    // Verify the tab has the premium-locked class
    await expect(favoritedMeTab).toHaveClass(/premium-locked/);
    
    // Verify the premium badge is shown
    await expect(favoritedMeTab.locator('.premium-badge')).toHaveText('Premium');
  });

  test('does not see activity when favorited by another user', async ({ page, loginAs, alice }) => {
    // First, login as Alice (premium) and favorite Bob
    await page.goto('/');
    await loginAs(alice);
    await goToDiscoverPage(page);
    
    // Favorite Bob
    await favoriteUserByName(page, 'Bob Test');
    
    // Now log out (go to home and login as Bob)
    await page.goto('/');
    
    // Login as Bob
    await page.getByRole('button', { name: /get started/i }).click();
    await page.locator('.modal-backdrop').waitFor();
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(TEST_USERS.bob.email);
    await page.locator('#password').fill(TEST_USERS.bob.password);
    await page.locator('.submit-btn').click();
    await page.waitForURL(/\/(discover|messages|settings|favorites)/, { timeout: 15000 });
    
    // Navigate to a page where activity sidebar is visible
    await goToDiscoverPage(page);
    
    // Check that the activity section does NOT show Alice favorited Bob
    // Non-premium users should not see who favorited them
    const hasActivity = await checkActivityForFavorite(page, 'Alice Test');
    expect(hasActivity).toBe(false);
  });
});

test.describe('Favorites - Premium User (Alice)', () => {
  test.beforeEach(async ({ page, loginAsAlice }) => {
    // Login as Alice (premium user)
    await loginAsAlice();
  });

  test('sees activity record when favorited by another user', async ({ page, loginAs, bob }) => {
    // First, login as Bob (non-premium) and favorite Alice
    await page.goto('/');
    await loginAs(bob);
    await goToDiscoverPage(page);
    
    // Favorite Alice
    await favoriteUserByName(page, 'Alice Test');
    
    // Now log out and login as Alice
    await page.goto('/');
    
    // Login as Alice
    await page.getByRole('button', { name: /get started/i }).click();
    await page.locator('.modal-backdrop').waitFor();
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(TEST_USERS.alice.email);
    await page.locator('#password').fill(TEST_USERS.alice.password);
    await page.locator('.submit-btn').click();
    await page.waitForURL(/\/(discover|messages|settings|favorites)/, { timeout: 15000 });
    
    // Navigate to a page where activity sidebar is visible
    await goToDiscoverPage(page);
    
    // Wait a moment for activities to load
    await page.waitForTimeout(1000);
    
    // Check that the activity section shows "Bob Test favorited you"
    const activitySection = page.locator('.sidebar-activity');
    await expect(activitySection).toBeVisible();
    
    // Find activity item with favorite type for Bob
    const favoriteActivity = activitySection.locator('.activity-item').filter({
      has: page.locator('.activity-text', { hasText: 'Bob Test favorited you' })
    });
    
    await expect(favoriteActivity).toBeVisible({ timeout: 10000 });
    
    // Verify it has the correct activity type badge
    await expect(favoriteActivity.locator('.activity-type-badge.type-favorite')).toBeVisible();
  });

  test('can access favorited-me tab on matches page', async ({ page }) => {
    await goToMatchesPage(page);
    
    // Find the "Favorited Me" tab button
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toBeVisible();
    
    // Verify the tab does NOT have the premium-locked class for premium users
    await expect(favoritedMeTab).not.toHaveClass(/premium-locked/);
    
    // Click the tab
    await favoritedMeTab.click();
    
    // Wait for tab to become active
    await expect(favoritedMeTab).toHaveClass(/active/);
  });

  test('sees user who favorited them in favorited-me section', async ({ page, loginAs, bob }) => {
    // First, login as Bob and favorite Alice
    await page.goto('/');
    await loginAs(bob);
    await goToDiscoverPage(page);
    
    // Favorite Alice
    await favoriteUserByName(page, 'Alice Test');
    
    // Now log out and login as Alice
    await page.goto('/');
    
    // Login as Alice
    await page.getByRole('button', { name: /get started/i }).click();
    await page.locator('.modal-backdrop').waitFor();
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(TEST_USERS.alice.email);
    await page.locator('#password').fill(TEST_USERS.alice.password);
    await page.locator('.submit-btn').click();
    await page.waitForURL(/\/(discover|messages|settings|favorites)/, { timeout: 15000 });
    
    // Go to matches page and click on "Favorited Me" tab
    await goToMatchesPage(page);
    
    // Click the "Favorited Me" tab
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await favoritedMeTab.click();
    await expect(favoritedMeTab).toHaveClass(/active/);
    
    // Wait for the profile grid to load
    await page.waitForTimeout(1000);
    
    // Check that Bob appears in the favorited-me list
    const profileGrid = page.locator('.matches-content .profile-grid');
    
    // Look for Bob's profile card
    const bobCard = profileGrid.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Bob Test' })
    });
    
    await expect(bobCard).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Favorites - Mutual Interaction', () => {
  test('mutual favorites creates a match', async ({ page, loginAsAlice, loginAs, bob }) => {
    // Login as Alice and favorite Bob
    await loginAsAlice();
    await goToDiscoverPage(page);
    await favoriteUserByName(page, 'Bob Test');
    
    // Login as Bob and favorite Alice
    await page.goto('/');
    await loginAs(bob);
    await goToDiscoverPage(page);
    await favoriteUserByName(page, 'Alice Test');
    
    // Now check if there's a match - go to matches page
    await goToMatchesPage(page);
    
    // The "My Matches" tab should be active by default
    const myMatchesTab = page.locator('.tab-btn', { hasText: 'My Matches' });
    await expect(myMatchesTab).toHaveClass(/active/);
    
    // Check for Alice in the matches
    const profileGrid = page.locator('.matches-content .profile-grid');
    const aliceCard = profileGrid.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Alice Test' })
    });
    
    // Alice should appear in Bob's matches
    await expect(aliceCard).toBeVisible({ timeout: 10000 });
  });
});
