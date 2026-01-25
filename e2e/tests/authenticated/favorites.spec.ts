import { test, expect } from '../fixtures/auth.fixture';
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

// Helper to log out the current user
async function logout(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.waitForTimeout(500);
  
  // Click on the logout setting item (opens a dialog)
  const logoutItem = page.locator('.setting-item', { has: page.locator('.logout-icon') });
  await logoutItem.waitFor({ state: 'visible', timeout: 10000 });
  await logoutItem.click();
  
  // Wait for logout dialog and click confirm button
  const logoutDialog = page.locator('.logout-dialog');
  await logoutDialog.waitFor({ state: 'visible', timeout: 5000 });
  
  // Click the confirm logout button (it's a warn colored button in the dialog)
  const confirmBtn = logoutDialog.locator('button[color="warn"]');
  await confirmBtn.click();
  
  // Wait for redirect to home page
  await page.waitForURL('/', { timeout: 10000 });
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(500);
  
  // Retry if favorited class doesn't appear (backend may be slow)
  const favoritedBtn = profileCard.locator('.action-btn.favorite.favorited');
  let isFavorited = await favoritedBtn.isVisible().catch(() => false);
  
  for (let attempt = 0; attempt < 3 && !isFavorited; attempt++) {
    await page.waitForTimeout(1000);
    isFavorited = await favoritedBtn.isVisible().catch(() => false);
    if (!isFavorited && attempt < 2) {
      // Try clicking again
      await favoriteBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  
  // Final assertion with longer timeout
  await expect(favoritedBtn).toBeVisible({ timeout: 10000 });
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
  test('cannot access favorited-me tab on matches page', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    
    // Find the "Favorited Me" tab button
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toBeVisible();
    
    // Verify the tab has the premium-locked class
    await expect(favoritedMeTab).toHaveClass(/premium-locked/);
    
    // Verify the premium badge is shown
    await expect(favoritedMeTab.locator('.premium-badge')).toHaveText('Premium');
  });

  test('does not see activity when favorited by another user', async ({ page, loginAs, alice, bob }) => {
    // First, login as Alice (premium) and favorite Bob
    await loginAs(alice);
    await goToDiscoverPage(page);
    
    // Favorite Bob
    await favoriteUserByName(page, bob.displayName);
    
    // Log out Alice
    await logout(page);
    
    // Login as Bob
    await loginAs(bob);
    
    // Navigate to a page where activity sidebar is visible
    await goToDiscoverPage(page);
    
    // Check that the activity section does NOT show Alice favorited Bob
    // Non-premium users should not see who favorited them
    const hasActivity = await checkActivityForFavorite(page, alice.displayName);
    expect(hasActivity).toBe(false);
  });
});

test.describe('Favorites - Premium User (Alice)', () => {
  test('can access favorited-me tab on matches page', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Wait for subscription status to load
    await page.waitForTimeout(1000);
    
    // Find the "Favorited Me" tab button
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toBeVisible();
    
    // Verify the tab does NOT have the premium-locked class for premium users
    // Note: If this fails, Alice's premium status may not be set up correctly in global setup
    await expect(favoritedMeTab).not.toHaveClass(/premium-locked/, { timeout: 10000 });
    
    // Click the tab
    await favoritedMeTab.click();
    
    // Wait for tab to become active
    await expect(favoritedMeTab).toHaveClass(/active/);
  });

  test('sees activity record when favorited by another user', async ({ page, loginAs, alice, bob }) => {
    // First, login as Bob (non-premium) and favorite Alice
    await loginAs(bob);
    await goToDiscoverPage(page);
    
    // Favorite Alice
    await favoriteUserByName(page, alice.displayName);
    
    // Log out Bob
    await logout(page);
    
    // Login as Alice
    await loginAs(alice);
    
    // Navigate to a page where activity sidebar is visible
    await goToDiscoverPage(page);
    
    // Wait a moment for activities to load
    await page.waitForTimeout(1000);
    
    // Check that the activity section shows "<bob> favorited you"
    const activitySection = page.locator('.sidebar-activity');
    await expect(activitySection).toBeVisible();
    
    // Find activity item with favorite type for Bob
    const favoriteActivity = activitySection.locator('.activity-item').filter({
      has: page.locator('.activity-text', { hasText: `${bob.displayName} favorited you` })
    });
    
    // Activity feeds can contain duplicates (e.g., retries or prior runs in live env).
    // Use .first() to avoid strict-mode violations while still asserting presence.
    await expect(favoriteActivity.first()).toBeVisible({ timeout: 10000 });
    
    // Verify it has the correct activity type badge
    await expect(favoriteActivity.first().locator('.activity-type-badge.type-favorite')).toBeVisible();
  });

  // Skip: This test depends on onFavoriteCreated Cloud Function populating the favorites data.
  // The Cloud Function execution is unreliable in the emulator environment.
  test('sees user who favorited them in favorited-me section', async ({ page, loginAs, alice, bob }) => {
    // Increase timeout for this multi-step test
    test.setTimeout(90000);
    
    // First, login as Bob and favorite Alice
    await loginAs(bob);
    await goToDiscoverPage(page);
    
    // Favorite Alice
    await favoriteUserByName(page, alice.displayName);
    
    // Wait for Cloud Function to process favorite
    await page.waitForTimeout(3000);
    
    // Log out Bob
    await logout(page);
    
    // Login as Alice
    await loginAs(alice);
    
    // Go to matches page and click on "Favorited Me" tab
    await goToMatchesPage(page);
    
    // Wait for subscription to load
    await page.waitForTimeout(1000);
    
    // Click the "Favorited Me" tab
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await favoritedMeTab.click();
    await page.waitForTimeout(500);
    await expect(favoritedMeTab).toHaveClass(/active/, { timeout: 10000 });
    
    // Wait for the profile grid to load
    await page.waitForTimeout(1000);
    
    // Check that Bob appears in the favorited-me list (with retries)
    const profileGrid = page.locator('.matches-content .profile-grid');
    const bobCard = profileGrid.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: bob.displayName })
    });
    
    // Retry if Bob doesn't appear immediately (Cloud Function may take time)
    let exists = await bobCard.isVisible().catch(() => false);
    for (let attempt = 0; attempt < 5 && !exists; attempt++) {
      console.log(`Retry ${attempt + 1}: Waiting for ${bob.displayName} to appear...`);
      await page.waitForTimeout(3000);
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1000);
      await favoritedMeTab.click();
      await page.waitForTimeout(500);
      exists = await bobCard.isVisible().catch(() => false);
    }
    
    await expect(bobCard).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Favorites - Mutual Interaction', () => {
  // Skip: This test depends on onFavoriteCreated Cloud Function creating match records.
  // The Cloud Function execution is unreliable in the emulator environment.
  test('mutual favorites creates a match', async ({ page, loginAs, alice, bob }) => {
    // Login as Alice and favorite Bob
    await loginAs(alice);
    await goToDiscoverPage(page);
    await favoriteUserByName(page, bob.displayName);
    
    // Log out Alice
    await logout(page);
    
    // Login as Bob and favorite Alice
    await loginAs(bob);
    await goToDiscoverPage(page);
    await favoriteUserByName(page, alice.displayName);
    
    // Now check if there's a match - go to matches page
    await goToMatchesPage(page);
    
    // The "My Matches" tab should be active by default
    const myMatchesTab = page.locator('.tab-btn', { hasText: 'My Matches' });
    await expect(myMatchesTab).toHaveClass(/active/);
    
    // Check for Alice in the matches
    const profileGrid = page.locator('.matches-content .profile-grid');
    const aliceCard = profileGrid.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: alice.displayName })
    });
    
    // Alice should appear in Bob's matches
    await expect(aliceCard).toBeVisible({ timeout: 10000 });
  });
});
