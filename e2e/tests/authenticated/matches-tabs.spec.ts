import { test, expect } from '../fixtures/auth.fixture';
import { Page } from '@playwright/test';

/**
 * Matches Page Tabs E2E Tests
 * 
 * Tests for all tabs in the matches page:
 * 
 * FREE TABS (available to all users):
 * - My Matches: Users who have mutually favorited each other
 * - My Favorites: Users the current user has favorited
 * - Recently Viewed: Profiles the current user has viewed
 * 
 * PREMIUM TABS (locked for non-premium users):
 * - Favorited Me: Users who have favorited the current user
 * - Viewed Me: Users who have viewed the current user's profile
 * 
 * NOTE: Tests use different discover page users to avoid parallel test interference.
 * Alice/Bob are reserved for favorites tests, other users for view tests.
 */

// Helper to navigate to discover page
async function goToDiscoverPage(page: Page): Promise<void> {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

// Helper to navigate to matches page
async function goToMatchesPage(page: Page): Promise<void> {
  await page.goto('/matches');
  await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

// Helper to log out
async function logout(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.waitForTimeout(1000);
  
  const logoutItem = page.locator('.setting-item', { has: page.locator('.logout-icon') });
  await logoutItem.waitFor({ state: 'visible', timeout: 10000 });
  
  // Retry clicking logout if dialog doesn't appear
  const logoutDialog = page.locator('.logout-dialog');
  for (let attempt = 0; attempt < 3; attempt++) {
    await logoutItem.click();
    await page.waitForTimeout(500);
    
    const dialogVisible = await logoutDialog.isVisible().catch(() => false);
    if (dialogVisible) break;
    
    if (attempt === 2) {
      await logoutDialog.waitFor({ state: 'visible', timeout: 5000 });
    }
  }
  
  const confirmBtn = logoutDialog.locator('button[color="warn"]');
  await confirmBtn.click();
  
  await page.waitForURL('/', { timeout: 10000 });
  await page.waitForTimeout(500);
}

// Helper to ensure a user is favorited (idempotent - only favorites if not already)
async function ensureFavorited(page: Page, displayName: string): Promise<void> {
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  await profileCard.waitFor({ state: 'visible', timeout: 10000 });
  
  const favoriteBtn = profileCard.locator('.action-btn.favorite');
  await favoriteBtn.waitFor({ state: 'visible' });
  
  // Check if already favorited
  const isAlreadyFavorited = await favoriteBtn.evaluate(el => el.classList.contains('favorited'));
  
  if (!isAlreadyFavorited) {
    await favoriteBtn.click();
    await page.waitForTimeout(500);
    
    // Retry if favorited class doesn't appear (sometimes needs a re-click or refresh)
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
}

// Helper to view a user's profile by clicking on their card
async function viewUserProfile(page: Page, displayName: string): Promise<void> {
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  await profileCard.waitFor({ state: 'visible', timeout: 10000 });
  
  // Click the view button on the card
  const viewBtn = profileCard.locator('.action-btn.view');
  if (await viewBtn.isVisible()) {
    await viewBtn.click();
  } else {
    // Fall back to clicking the card itself
    await profileCard.click();
  }
  
  // Wait for profile page to load
  await page.waitForURL(/\/user\//, { timeout: 10000 });
  
  // Wait for the profile page content to fully load
  await page.locator('.profile-page, app-user-profile, .user-profile').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  
  // Give backend time to record the view
  await page.waitForTimeout(2000);
}

// Helper to click a tab on the matches page
async function clickMatchesTab(page: Page, tabName: string): Promise<void> {
  // Wait for any snackbars to disappear (they auto-dismiss after a few seconds)
  const snackbar = page.locator('.mat-mdc-snack-bar-container');
  if (await snackbar.isVisible().catch(() => false)) {
    await snackbar.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  }
  
  const tab = page.locator('.tab-btn', { hasText: tabName });
  await tab.click({ force: true }); // Force click to bypass any remaining overlays
  await page.waitForTimeout(500);
}

// Helper to check if a user appears in the current matches tab
async function userExistsInTab(page: Page, displayName: string): Promise<boolean> {
  await page.waitForTimeout(500); // Allow content to load
  const profileGrid = page.locator('.matches-content .profile-grid');
  const profileCard = profileGrid.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  return await profileCard.count() > 0;
}

// Helper to verify a user appears in the current tab
async function expectUserInTab(page: Page, displayName: string): Promise<void> {
  const profileGrid = page.locator('.matches-content .profile-grid');
  const profileCard = profileGrid.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  await expect(profileCard).toBeVisible({ timeout: 10000 });
}

// Helper to wait for tab content to load (either profiles or empty state)
async function waitForTabContent(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
  
  // Wait for either profile grid with cards or empty state
  const hasContent = await Promise.race([
    page.locator('.matches-content .profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
    page.locator('.empty-state').waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
  ]);
  
  if (!hasContent) {
    // Content may still be loading, wait a bit more
    await page.waitForTimeout(1000);
  }
}

test.describe('Matches Tabs - Tab Structure', () => {
  test('displays all five tabs', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Verify all tabs are visible
    await expect(page.locator('.tab-btn', { hasText: 'My Matches' })).toBeVisible();
    await expect(page.locator('.tab-btn', { hasText: 'My Favorites' })).toBeVisible();
    await expect(page.locator('.tab-btn', { hasText: 'Recently Viewed' })).toBeVisible();
    await expect(page.locator('.tab-btn', { hasText: 'Favorited Me' })).toBeVisible();
    await expect(page.locator('.tab-btn', { hasText: 'Viewed Me' })).toBeVisible();
  });

  test('My Matches is the default active tab', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    const myMatchesTab = page.locator('.tab-btn', { hasText: 'My Matches' });
    await expect(myMatchesTab).toHaveClass(/active/);
  });

  test('clicking a tab makes it active', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Click My Favorites tab
    await clickMatchesTab(page, 'My Favorites');
    await expect(page.locator('.tab-btn', { hasText: 'My Favorites' })).toHaveClass(/active/);
    
    // Click Recently Viewed tab
    await clickMatchesTab(page, 'Recently Viewed');
    await expect(page.locator('.tab-btn', { hasText: 'Recently Viewed' })).toHaveClass(/active/);
  });
});

test.describe('Matches Tabs - Premium Lock Status', () => {
  test('non-premium user sees Favorited Me and Viewed Me as locked', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    
    // Favorited Me should be locked
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toHaveClass(/premium-locked/);
    await expect(favoritedMeTab.locator('.premium-badge')).toHaveText('Premium');
    
    // Viewed Me should be locked
    const viewedMeTab = page.locator('.tab-btn', { hasText: 'Viewed Me' });
    await expect(viewedMeTab).toHaveClass(/premium-locked/);
    await expect(viewedMeTab.locator('.premium-badge')).toHaveText('Premium');
  });

  test('premium user sees Favorited Me and Viewed Me as unlocked', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Wait for subscription to load (may take time)
    await page.waitForTimeout(2000);
    
    // Favorited Me should NOT be locked - retry if premium status hasn't loaded
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    let hasLockClass = await favoritedMeTab.evaluate(el => el.classList.contains('premium-locked'));
    for (let attempt = 0; attempt < 5 && hasLockClass; attempt++) {
      console.log(`Retry ${attempt + 1}: Waiting for premium status to load...`);
      await page.waitForTimeout(1000);
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1000);
      hasLockClass = await favoritedMeTab.evaluate(el => el.classList.contains('premium-locked'));
    }
    
    await expect(favoritedMeTab).not.toHaveClass(/premium-locked/, { timeout: 10000 });
    
    // Viewed Me should NOT be locked
    const viewedMeTab = page.locator('.tab-btn', { hasText: 'Viewed Me' });
    await expect(viewedMeTab).not.toHaveClass(/premium-locked/);
  });

  test('free tabs are not locked for non-premium user', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    
    // My Matches should not be locked
    await expect(page.locator('.tab-btn', { hasText: 'My Matches' })).not.toHaveClass(/premium-locked/);
    
    // My Favorites should not be locked
    await expect(page.locator('.tab-btn', { hasText: 'My Favorites' })).not.toHaveClass(/premium-locked/);
    
    // Recently Viewed should not be locked
    await expect(page.locator('.tab-btn', { hasText: 'Recently Viewed' })).not.toHaveClass(/premium-locked/);
  });
});

test.describe('Matches Tabs - My Favorites Tab', () => {
  test('shows users that current user has favorited', async ({ page, loginAs, alice, bob }) => {
    // Login as Alice and ensure Bob is favorited
    await loginAs(alice);
    await goToDiscoverPage(page);
    
    // Ensure Bob is favorited (idempotent - won't toggle if already favorited)
    await ensureFavorited(page, bob.displayName);
    
    // Navigate to matches and check My Favorites tab
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'My Favorites');
    await waitForTabContent(page);
    
    // Bob should appear in My Favorites
    await expectUserInTab(page, bob.displayName);
  });

  // Skip: This test is flaky due to slow tab content loading in the emulator environment.
  test('tab shows content or empty state', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'My Favorites');
    await waitForTabContent(page);
    
    // Check for empty state or profiles with retry - both are valid states
    const profileGrid = page.locator('.matches-content .profile-grid');
    const emptyState = page.locator('.empty-state');
    
    let hasProfiles = await profileGrid.locator('app-profile-card').count() > 0;
    let hasEmptyState = await emptyState.isVisible();
    
    // Retry if neither is visible yet
    for (let attempt = 0; attempt < 5 && !hasProfiles && !hasEmptyState; attempt++) {
      await page.waitForTimeout(1000);
      hasProfiles = await profileGrid.locator('app-profile-card').count() > 0;
      hasEmptyState = await emptyState.isVisible();
    }
    
    expect(hasProfiles || hasEmptyState).toBe(true);
  });
});

test.describe('Matches Tabs - My Matches Tab', () => {
  // Skip: This test depends on onFavoriteCreated Cloud Function creating match records.
  // The Cloud Function execution is unreliable in the emulator environment.
  test('shows users with mutual favorites', async ({ page, loginAs, alice, bob }) => {
    // Increase timeout for this multi-step test
    test.setTimeout(90000);
    
    // Ensure mutual favorites: Alice <-> Bob
    
    // First, login as Alice and ensure Bob is favorited
    await loginAs(alice);
    await goToDiscoverPage(page);
    await ensureFavorited(page, bob.displayName);
    
    // Wait for favorite to be recorded by Cloud Function
    await page.waitForTimeout(2000);
    await logout(page);
    
    // Then, login as Bob and ensure Alice is favorited
    await loginAs(bob);
    await goToDiscoverPage(page);
    await ensureFavorited(page, alice.displayName);
    
    // Wait for favorite to be recorded and match to be created by Cloud Function
    await page.waitForTimeout(3000);
    
    // Check Bob's My Matches - Alice should appear (mutual favorites)
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'My Matches');
    await waitForTabContent(page);
    
    // Retry multiple times if Alice doesn't appear (Cloud Function may take time)
    let exists = await userExistsInTab(page, alice.displayName);
    for (let attempt = 0; attempt < 3 && !exists; attempt++) {
      await page.waitForTimeout(2000);
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await clickMatchesTab(page, 'My Matches');
      await waitForTabContent(page);
      exists = await userExistsInTab(page, alice.displayName);
    }
    
    await expectUserInTab(page, alice.displayName);
  });

  // Skip: This test is flaky due to slow tab content loading in the emulator environment.
  test('tab content loads correctly', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'My Matches');
    await waitForTabContent(page);
    
    // Wait extra time for content to load
    await page.waitForTimeout(2000);
    
    // Verify either profiles or empty state is shown
    const profileGrid = page.locator('.matches-content .profile-grid');
    const emptyState = page.locator('.empty-state');
    
    // Check multiple times in case of slow loading
    let hasProfiles = false;
    let hasEmptyState = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      hasProfiles = await profileGrid.locator('app-profile-card').count() > 0;
      hasEmptyState = await emptyState.isVisible().catch(() => false);
      
      if (hasProfiles || hasEmptyState) break;
      await page.waitForTimeout(500);
    }
    
    expect(hasProfiles || hasEmptyState).toBe(true);
  });
});

test.describe('Matches Tabs - Recently Viewed Tab', () => {
  // Skip: This test depends on profile views being recorded in the backend which 
  // requires Cloud Functions. The Cloud Function execution is unreliable in the emulator.
  test('shows profiles the current user has viewed', async ({ page, loginAs, alice, bob }) => {
    // Increase timeout for this test
    test.setTimeout(60000);
    
    // Use Bob to view Alice (avoiding parallel interference with Alice's tests)
    await loginAs(bob);
    await goToDiscoverPage(page);
    
    // View Alice's profile
    await viewUserProfile(page, alice.displayName);
    
    // Wait for profile view to be recorded
    await page.waitForTimeout(3000);
    
    // Go back and check Recently Viewed
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'Recently Viewed');
    
    // Wait longer for recently viewed to load (backend may have delay)
    await page.waitForTimeout(2000);
    await waitForTabContent(page);
    
    // Alice should appear in Recently Viewed - retry multiple times if needed
    let exists = await userExistsInTab(page, alice.displayName);
    for (let attempt = 0; attempt < 3 && !exists; attempt++) {
      console.log(`Retry ${attempt + 1}: Waiting for ${alice.displayName} in Recently Viewed...`);
      await page.waitForTimeout(2000);
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await clickMatchesTab(page, 'Recently Viewed');
      await waitForTabContent(page);
      exists = await userExistsInTab(page, alice.displayName);
    }
    await expectUserInTab(page, alice.displayName);
  });

  // Skip: This test is flaky due to slow tab content loading in the emulator environment.
  test('tab content loads correctly', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'Recently Viewed');
    await waitForTabContent(page);
    
    // Either empty state or profiles should be visible with retry
    const profileGrid = page.locator('.matches-content .profile-grid');
    const emptyState = page.locator('.empty-state');
    
    let hasProfiles = await profileGrid.locator('app-profile-card').count() > 0;
    let hasEmptyState = await emptyState.isVisible();
    
    // Retry if neither is visible yet
    for (let attempt = 0; attempt < 5 && !hasProfiles && !hasEmptyState; attempt++) {
      await page.waitForTimeout(1000);
      hasProfiles = await profileGrid.locator('app-profile-card').count() > 0;
      hasEmptyState = await emptyState.isVisible();
    }
    
    expect(hasProfiles || hasEmptyState).toBe(true);
  });
});

test.describe('Matches Tabs - Favorited Me Tab (Premium)', () => {
  // Skip: This test is flaky because the premium subscription status doesn't always load quickly enough.
  test('premium user can access Favorited Me tab', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Wait for subscription to load - tab should NOT be premium-locked
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).not.toHaveClass(/premium-locked/, { timeout: 15000 });
    
    // Click Favorited Me tab
    await clickMatchesTab(page, 'Favorited Me');
    await page.waitForTimeout(500);
    
    // Verify tab is active (retry click if not)
    let isActive = await favoritedMeTab.evaluate(el => el.classList.contains('active'));
    if (!isActive) {
      await favoritedMeTab.click();
      await page.waitForTimeout(500);
    }
    
    await expect(favoritedMeTab).toHaveClass(/active/, { timeout: 10000 });
    await waitForTabContent(page);
  });

  // Skip: This test depends on onFavoriteCreated Cloud Function populating the favorites data.
  // The Cloud Function execution is unreliable in the emulator environment.
  test('premium user sees who favorited them', async ({ page, loginAs, alice, bob }) => {
    // Increase timeout for this multi-step test with retries
    test.setTimeout(90000);
    
    // Bob favorites Alice
    await loginAs(bob);
    await goToDiscoverPage(page);
    await ensureFavorited(page, alice.displayName);
    
    // Wait for favorite to be recorded
    await page.waitForTimeout(3000);
    await logout(page);
    
    // Alice (premium) checks Favorited Me
    await loginAs(alice);
    await goToMatchesPage(page);
    await page.waitForTimeout(1000); // Wait for subscription
    
    await clickMatchesTab(page, 'Favorited Me');
    await waitForTabContent(page);
    
    // Retry multiple times if Bob doesn't appear (Cloud Function may take time)
    let exists = await userExistsInTab(page, bob.displayName);
    for (let attempt = 0; attempt < 5 && !exists; attempt++) {
      console.log(`Retry ${attempt + 1}: Waiting for ${bob.displayName} to appear in Favorited Me...`);
      await page.waitForTimeout(3000);
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1000);
      await clickMatchesTab(page, 'Favorited Me');
      await waitForTabContent(page);
      exists = await userExistsInTab(page, bob.displayName);
    }
    
    // Bob should appear in Favorited Me
    await expectUserInTab(page, bob.displayName);
  });

  test('non-premium user cannot access Favorited Me tab', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    
    // Click on Favorited Me (should trigger upgrade prompt, not switch tabs)
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await favoritedMeTab.click();
    await page.waitForTimeout(500);
    
    // Tab should NOT become active (My Matches should still be active)
    await expect(page.locator('.tab-btn', { hasText: 'My Matches' })).toHaveClass(/active/);
  });
});

test.describe('Matches Tabs - Viewed Me Tab (Premium)', () => {
  // Skip: This test is flaky because the premium subscription status doesn't always load quickly enough.
  test('premium user can access Viewed Me tab', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Wait for subscription to load
    await page.waitForTimeout(1000);
    
    // Verify tab is not locked (premium status loaded)
    const viewedMeTab = page.locator('.tab-btn', { hasText: 'Viewed Me' });
    await expect(viewedMeTab).not.toHaveClass(/premium-locked/, { timeout: 10000 });
    
    // Click Viewed Me tab
    await viewedMeTab.click();
    await page.waitForTimeout(500);
    
    // Verify tab is active
    await expect(viewedMeTab).toHaveClass(/active/, { timeout: 5000 });
    await waitForTabContent(page);
  });

  // Skip: This test depends on onProfileViewCreated Cloud Function populating the view data.
  // The Cloud Function execution is unreliable in the emulator environment.
  test('premium user sees who viewed them', async ({ page, loginAs, alice, bob }) => {
    // Bob views Alice's profile
    await loginAs(bob);
    await goToDiscoverPage(page);
    await viewUserProfile(page, alice.displayName);
    
    // Wait for view to be recorded on backend
    await page.waitForTimeout(2000);
    await logout(page);
    
    // Alice (premium) checks Viewed Me
    await loginAs(alice);
    await goToMatchesPage(page);
    await page.waitForTimeout(1000); // Wait for subscription
    
    await clickMatchesTab(page, 'Viewed Me');
    
    // Wait longer for viewed-me data to load
    await page.waitForTimeout(2000);
    await waitForTabContent(page);
    
    // Check if Bob appears; if not, refresh and try again
    const exists = await userExistsInTab(page, bob.displayName);
    if (!exists) {
      await page.reload();
      await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1000);
      await clickMatchesTab(page, 'Viewed Me');
      await waitForTabContent(page);
    }
    
    // Bob should appear in Viewed Me
    await expectUserInTab(page, bob.displayName);
  });

  test('non-premium user cannot access Viewed Me tab', async ({ page, loginAsBob }) => {
    await loginAsBob();
    await goToMatchesPage(page);
    
    // Click on Viewed Me (should trigger upgrade prompt, not switch tabs)
    const viewedMeTab = page.locator('.tab-btn', { hasText: 'Viewed Me' });
    await viewedMeTab.click();
    await page.waitForTimeout(500);
    
    // Tab should NOT become active
    await expect(page.locator('.tab-btn', { hasText: 'My Matches' })).toHaveClass(/active/);
  });
});

test.describe('Matches Tabs - URL Query Params', () => {
  test('tab selection is reflected in URL', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    
    // Click My Favorites
    await clickMatchesTab(page, 'My Favorites');
    await expect(page).toHaveURL(/tab=my-favorites/);
    
    // Click Recently Viewed
    await clickMatchesTab(page, 'Recently Viewed');
    await expect(page).toHaveURL(/tab=my-views/);
  });

  test('can navigate directly to a tab via URL', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    
    // Navigate directly to my-favorites tab
    await page.goto('/matches?tab=my-favorites');
    await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
    
    // My Favorites should be active
    await expect(page.locator('.tab-btn', { hasText: 'My Favorites' })).toHaveClass(/active/);
  });
});

test.describe('Matches Tabs - Empty States', () => {
  test('My Favorites shows explore button in empty state', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'My Favorites');
    await waitForTabContent(page);
    
    const emptyState = page.locator('.empty-state');
    if (await emptyState.isVisible()) {
      await expect(emptyState.locator('.empty-message')).toContainText(/haven't favorited/i);
      await expect(page.locator('button', { hasText: 'Explore Profiles' })).toBeVisible();
    }
    // If profiles exist, test passes (valid state)
  });

  test('Recently Viewed shows appropriate message in empty state', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMatchesPage(page);
    await clickMatchesTab(page, 'Recently Viewed');
    await waitForTabContent(page);
    
    const emptyState = page.locator('.empty-state');
    if (await emptyState.isVisible()) {
      await expect(emptyState.locator('.empty-message')).toContainText(/haven't viewed/i);
    }
    // If profiles exist, test passes (valid state)
  });
});
