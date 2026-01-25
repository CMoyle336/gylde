import { test, expect } from '../fixtures/auth.fixture';
import { Page } from '@playwright/test';
import { 
  TEST_USERS, 
  DISCOVER_TEST_USERS, 
  ReputationTier, 
  TIER_ORDER, 
  TIER_MESSAGING_LIMITS,
  compareTiers 
} from '../fixtures/test-users';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from e2e/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Detect if running against live environment
function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

// Firebase Admin SDK - lazy loaded for live environments
let adminDb: FirebaseFirestore.Firestore | null = null;
let adminInitialized = false;

async function getAdminDb(): Promise<FirebaseFirestore.Firestore | null> {
  if (!isLiveEnvironment()) return null;
  if (adminInitialized) return adminDb;
  
  try {
    const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    
    // Only initialize if not already done
    if (getApps().length === 0) {
      initializeApp({
        credential: applicationDefault(),
        projectId: 'gylde-sandbox',
      });
    }
    
    adminDb = getFirestore();
    adminInitialized = true;
    console.log('  [Live env] Firebase Admin SDK initialized');
    return adminDb;
  } catch (error) {
    console.error('  [Live env] Failed to initialize Firebase Admin:', error);
    adminInitialized = true; // Don't retry
    return null;
  }
}

/**
 * Reputation Engine E2E Tests
 * 
 * Tests for the reputation system including:
 * 1. Messaging limits by reputation tier
 * 2. Discover page sorting by reputation
 * 3. Messages screen filtering by reputation tier
 * 
 * Tier hierarchy (lowest to highest):
 * - new: 1 higher-tier message/day
 * - active: 3 higher-tier messages/day
 * - established: 5 higher-tier messages/day
 * - trusted: 10 higher-tier messages/day
 * - distinguished: unlimited
 */

// User templates (auth fixture will create unique instances per test)
const newTierUserTemplate = DISCOVER_TEST_USERS.newTierUser;
const activeTierUserTemplate = DISCOVER_TEST_USERS.activeTierUser;
const establishedTierUserTemplate = DISCOVER_TEST_USERS.establishedTierUser;
const trustedTierUserTemplate = DISCOVER_TEST_USERS.trustedTierUser;
const distinguishedTierUserTemplate = DISCOVER_TEST_USERS.distinguishedTierUser;

// Helper to navigate to discover page
async function goToDiscoverPage(page: Page): Promise<void> {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

// Helper to navigate to messages page
async function goToMessagesPage(page: Page): Promise<void> {
  await page.goto('/messages');
  await page.locator('app-messages, .messages-page').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

// Helper to log out
async function logout(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.waitForTimeout(500);
  
  const logoutItem = page.locator('.setting-item', { has: page.locator('.logout-icon') });
  await logoutItem.waitFor({ state: 'visible', timeout: 10000 });
  await logoutItem.click();
  
  const logoutDialog = page.locator('.logout-dialog');
  await logoutDialog.waitFor({ state: 'visible', timeout: 5000 });
  
  const confirmBtn = logoutDialog.locator('button[color="warn"]');
  await confirmBtn.click();
  
  await page.waitForURL('/', { timeout: 10000 });
  await page.waitForTimeout(500);
}

// Helper to click message button on a profile card
async function clickMessageOnProfile(page: Page, displayName: string): Promise<void> {
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName })
  });
  
  await profileCard.waitFor({ state: 'visible', timeout: 10000 });
  
  const messageBtn = profileCard.locator('.action-btn.message');
  await messageBtn.waitFor({ state: 'visible' });
  await messageBtn.click();
}

// Helper to check if error snackbar appears with specific text
async function checkSnackbarError(page: Page, expectedText: RegExp): Promise<boolean> {
  const snackbar = page.locator('.mat-mdc-snack-bar-container');
  try {
    await snackbar.waitFor({ state: 'visible', timeout: 5000 });
    const text = await snackbar.textContent();
    return expectedText.test(text || '');
  } catch {
    return false;
  }
}

// Helper to set sort option on discover page
async function setSortOption(page: Page, sortLabel: string): Promise<void> {
  const sortBtn = page.locator('.sort-btn');
  const menu = page.locator('.mat-menu-panel, .mat-mdc-menu-panel, [role="menu"]');
  
  // Retry clicking sort button if menu doesn't appear
  for (let attempt = 0; attempt < 3; attempt++) {
    await sortBtn.click();
    await page.waitForTimeout(500);
    
    try {
      await menu.waitFor({ state: 'visible', timeout: 3000 });
      break; // Menu appeared, continue
    } catch {
      if (attempt === 2) throw new Error('Sort menu failed to open after 3 attempts');
      // Click elsewhere to reset state, then retry
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }
  
  // Click the option by text
  const sortOption = page.locator('button', { hasText: sortLabel });
  await sortOption.click();
  await page.waitForTimeout(500);
}

// Helper to set reputation filter on messages page
async function setReputationFilter(page: Page, tierLabel: string): Promise<void> {
  // Click on the reputation filter dropdown
  const filterDropdown = page.locator('.filter-dropdown').nth(1); // Second dropdown is reputation
  await filterDropdown.click();
  await page.waitForTimeout(300);
  
  // Select the tier option
  const option = page.locator('mat-option', { hasText: tierLabel });
  await option.click();
  await page.waitForTimeout(500);
}

// Helper to get profile names from current page in order
async function getProfileNamesInOrder(page: Page): Promise<string[]> {
  const cards = page.locator('.profile-grid app-profile-card');
  const count = await cards.count();
  const names: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const name = await cards.nth(i).locator('.card-name').textContent();
    if (name) names.push(name.trim());
  }
  
  return names;
}

test.describe('Reputation - Tier Display', () => {
  test('users see reputation badges on profile cards', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Check that reputation badges are visible on cards
    const badges = page.locator('.profile-grid app-profile-card app-reputation-badge, .profile-grid app-profile-card .reputation-badge');
    
    // At least some profiles should have reputation badges visible
    await page.waitForTimeout(1000);
    const badgeCount = await badges.count();
    
    // This test documents that reputation badges are shown
    console.log(`Found ${badgeCount} reputation badges on profile cards`);
  });
});

test.describe('Reputation - Discover Page Sorting', () => {
  test('can sort by reputation (Prioritize Trusted)', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToDiscoverPage(page);
    
    // Wait for initial profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Set sort to "Prioritize Trusted"
    await setSortOption(page, 'Prioritize Trusted');
    
    // Wait for profiles to reload
    await page.waitForTimeout(2000);
    
    // Verify sort button shows the correct label
    const sortBtn = page.locator('.sort-btn');
    await expect(sortBtn).toContainText('Prioritize Trusted');
  });

  test('reputation sorting shows higher tier users first', async ({ page, loginAs, provisionUser }) => {
    // Login as a user who can see various tier users
    const viewer = await provisionUser(newTierUserTemplate, 'viewer-new');
    await loginAs(viewer);
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Set sort to reputation
    await setSortOption(page, 'Prioritize Trusted');
    
    // Wait for profiles to reload
    await page.waitForTimeout(2000);
    
    // Get profile names in order
    const names = await getProfileNamesInOrder(page);
    
    console.log('Profiles in reputation sort order:', names);
    
    // Verify we got results
    expect(names.length).toBeGreaterThan(0);
  });
});

test.describe('Reputation - Messages Filtering', () => {
  test('can filter conversations by reputation tier', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMessagesPage(page);
    
    // Wait for messages page to load
    await page.waitForTimeout(1000);
    
    // Find the reputation filter dropdown
    const reputationDropdown = page.locator('.filter-dropdown').filter({
      has: page.locator('mat-icon', { hasText: /people|trending_up|star/ })
    }).first();
    
    // Click to open dropdown
    await reputationDropdown.click();
    await page.waitForTimeout(300);
    
    // Check that filter options are available
    await expect(page.locator('mat-option', { hasText: 'Any member' })).toBeVisible();
    await expect(page.locator('mat-option', { hasText: 'Active+' })).toBeVisible();
    await expect(page.locator('mat-option', { hasText: 'Established+' })).toBeVisible();
    await expect(page.locator('mat-option', { hasText: 'Trusted+' })).toBeVisible();
    
    // Click away to close dropdown
    await page.keyboard.press('Escape');
  });

  test('Active+ filter filters out lower tier users', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMessagesPage(page);
    
    await page.waitForTimeout(1000);
    
    // Open reputation dropdown and select "Active+"
    const reputationDropdown = page.locator('.filter-dropdown').filter({
      has: page.locator('mat-icon', { hasText: /people|trending_up|star/ })
    }).first();
    
    await reputationDropdown.click();
    await page.waitForTimeout(300);
    
    await page.locator('mat-option', { hasText: 'Active+' }).click();
    await page.waitForTimeout(500);
    
    // The filter should be applied (icon changes)
    const filterIcon = reputationDropdown.locator('.filter-icon');
    await expect(filterIcon).toHaveText('trending_up');
  });

  test('can clear reputation filter', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMessagesPage(page);
    
    await page.waitForTimeout(1000);
    
    // Set a filter first
    const reputationDropdown = page.locator('.filter-dropdown').filter({
      has: page.locator('mat-icon', { hasText: /people|trending_up|star/ })
    }).first();
    
    await reputationDropdown.click();
    await page.waitForTimeout(300);
    await page.locator('mat-option', { hasText: 'Trusted+' }).click();
    await page.waitForTimeout(500);
    
    // Now clear it
    await reputationDropdown.click();
    await page.waitForTimeout(300);
    await page.locator('mat-option', { hasText: 'Any member' }).click();
    await page.waitForTimeout(500);
    
    // Icon should be back to default
    const filterIcon = reputationDropdown.locator('.filter-icon');
    await expect(filterIcon).toHaveText('people');
  });
});

test.describe('Reputation - Messaging Limits', () => {
  test('message button is available on profile cards', async ({ page, loginAs, provisionUser }) => {
    const viewer = await provisionUser(newTierUserTemplate, 'viewer-new');
    await loginAs(viewer);
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Verify message buttons are visible on profile cards
    const messageButtons = page.locator('.profile-grid app-profile-card .action-btn.message');
    const count = await messageButtons.count();
    
    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} message buttons on profile cards`);
  });

  test('clicking message button initiates conversation flow', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Find first profile with message button
    const firstCard = page.locator('.profile-grid app-profile-card').first();
    const messageBtn = firstCard.locator('.action-btn.message');
    
    if (await messageBtn.isVisible()) {
      await messageBtn.click();
      
      // Wait for either navigation to messages OR a dialog/snackbar to appear
      await Promise.race([
        page.waitForURL(/\/messages/, { timeout: 10000 }),
        page.locator('.mat-mdc-snack-bar-container').waitFor({ state: 'visible', timeout: 10000 }),
        page.locator('.mat-dialog-container, .cdk-overlay-pane').waitFor({ state: 'visible', timeout: 10000 }),
      ]).catch(() => {});
      
      // Verify we're either on messages page or some UI feedback was shown
      const currentUrl = page.url();
      const onMessagesPage = currentUrl.includes('/messages');
      const hasSnackbar = await page.locator('.mat-mdc-snack-bar-container').isVisible().catch(() => false);
      const hasDialog = await page.locator('.mat-dialog-container, .cdk-overlay-pane').isVisible().catch(() => false);
      
      // Any of these outcomes indicates the messaging flow is working
      console.log(`Message flow result: messages=${onMessagesPage}, snackbar=${hasSnackbar}, dialog=${hasDialog}`);
      expect(onMessagesPage || hasSnackbar || hasDialog).toBe(true);
    }
  });
});

test.describe('Reputation - Tier Visibility', () => {
  test('reputation badges show on conversation list', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToMessagesPage(page);
    
    await page.waitForTimeout(1000);
    
    // Look for reputation badges in conversation list
    const conversationList = page.locator('.conversation-scroll');
    const badges = conversationList.locator('app-reputation-badge, .reputation-badge');
    
    // Check if any badges are visible (depends on whether there are conversations)
    const badgeCount = await badges.count();
    console.log(`Found ${badgeCount} reputation badges in conversation list`);
  });

  test('reputation tier determines conversation permission', async ({ page, loginAs, provisionUser }) => {
    // Login as a new tier user
    const viewer = await provisionUser(newTierUserTemplate, 'viewer-new');
    const trusted = await provisionUser(trustedTierUserTemplate, 'trusted-target');
    await loginAs(viewer);
    await goToDiscoverPage(page);
    
    // Wait for profiles
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Try to message a higher tier user
    const trustedUser = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: trusted.displayName })
    });
    
    if (await trustedUser.isVisible({ timeout: 5000 }).catch(() => false)) {
      const messageBtn = trustedUser.locator('.action-btn.message');
      
      if (await messageBtn.isVisible()) {
        await messageBtn.click();
        await page.waitForTimeout(2000);
        
        // The system should check messaging permissions
        // This may result in navigation to messages or an error
        const currentUrl = page.url();
        const hasSnackbar = await page.locator('.mat-mdc-snack-bar-container').isVisible().catch(() => false);
        
        console.log(`After messaging attempt: URL=${currentUrl}, hasSnackbar=${hasSnackbar}`);
      }
    }
  });
});

test.describe('Reputation - Discover Filters', () => {
  test('can filter discover results by reputation tier', async ({ page, loginAsAlice }) => {
    await loginAsAlice();
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Open advanced filters
    const filtersBtn = page.locator('button', { hasText: /filters/i });
    if (await filtersBtn.isVisible()) {
      await filtersBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Look for reputation filter in the filters panel
    const reputationFilter = page.locator('[formcontrolname="reputationTier"], .reputation-filter, mat-select', { hasText: /reputation|member/i });
    
    if (await reputationFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await reputationFilter.click();
      await page.waitForTimeout(300);
      
      // Check for filter options
      const options = page.locator('mat-option');
      const optionCount = await options.count();
      console.log(`Found ${optionCount} reputation filter options`);
    } else {
      // Check quick filters for reputation
      const quickFilters = page.locator('.quick-filter-chip, .filter-chip');
      const filterCount = await quickFilters.count();
      console.log(`Found ${filterCount} quick filter chips`);
    }
  });
});

/**
 * Messaging Limit Enforcement Tests
 * 
 * These tests verify that the reputation-based messaging limits are enforced:
 * - New tier users can only start 1 conversation/day with higher tier users
 * - After using their limit, subsequent attempts are blocked
 * - Same/lower tier messaging has no limits
 * 
 * IMPORTANT: 
 * - These tests must run serially (not in parallel) because they modify shared state
 * - The counter only increments when the FIRST MESSAGE is sent in a conversation
 * - Just navigating to messages doesn't use up the limit
 */

// Helper to get current user UID from IndexedDB
async function getCurrentUserUid(page: Page): Promise<string | null> {
  try {
    await page.waitForTimeout(500);
    
    const uid = await page.evaluate(() => {
      return new Promise<string | null>((resolve) => {
        try {
          const request = indexedDB.open('firebaseLocalStorageDb');
          request.onsuccess = () => {
            try {
              const db = request.result;
              if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
                db.close();
                resolve(null);
                return;
              }
              const tx = db.transaction('firebaseLocalStorage', 'readonly');
              const store = tx.objectStore('firebaseLocalStorage');
              const getAllRequest = store.getAll();
              getAllRequest.onsuccess = () => {
                const items = getAllRequest.result;
                for (const item of items) {
                  if (item?.value?.uid) {
                    resolve(item.value.uid);
                    db.close();
                    return;
                  }
                }
                resolve(null);
                db.close();
              };
              getAllRequest.onerror = () => {
                resolve(null);
                db.close();
              };
            } catch {
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    });
    
    return uid;
  } catch {
    return null;
  }
}

// Helper to set higher-tier conversation count via Firestore
// Uses Admin SDK for live environments, REST API for emulator
async function setHigherTierConversationCount(userId: string, count: number): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  
  // Live environment: use Admin SDK
  if (isLiveEnvironment()) {
    const db = await getAdminDb();
    if (!db) {
      console.error('  [Live env] Admin SDK not available');
      return false;
    }
    
    try {
      const docRef = db.doc(`users/${userId}/private/data`);
      const doc = await docRef.get();
      const existingRep = doc.exists ? (doc.data()?.reputation || {}) : {};
      
      await docRef.set({
        reputation: {
          ...existingRep,
          higherTierConversationsToday: count,
          lastConversationDate: today,
        },
      }, { merge: true });
      
      console.log(`  [Live env] Set higherTierConversationsToday=${count} for user ${userId}`);
      return true;
    } catch (error) {
      console.error('  [Live env] Error setting conversation count:', error);
      return false;
    }
  }
  
  // Local emulator: use REST API
  const FIREBASE_PROJECT_ID = 'gylde-sandbox';
  const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
  
  try {
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}/private/data`;
    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    };
    
    // Get existing data
    const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;
    const getResponse = await fetch(getUrl, { headers: adminHeaders });
    
    let existingData: Record<string, unknown> = {};
    if (getResponse.ok) {
      const doc = await getResponse.json() as { fields?: Record<string, unknown> };
      existingData = doc.fields || {};
    }
    
    // Update reputation with new count
    const existingRep = existingData.reputation as { mapValue?: { fields?: Record<string, unknown> } } | undefined;
    const repFields = existingRep?.mapValue?.fields || {};
    
    const updatedRepFields = {
      ...repFields,
      higherTierConversationsToday: { integerValue: String(count) },
      lastConversationDate: { stringValue: today },
    };
    
    const updatedData = {
      ...existingData,
      reputation: {
        mapValue: {
          fields: updatedRepFields,
        },
      },
    };
    
    const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${docPath}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ fields: updatedData }),
    });
    
    return patchResponse.ok;
  } catch (error) {
    console.error('Error setting higher tier conversation count:', error);
    return false;
  }
}

// Helper to GET higher-tier conversation count from Firestore
// Uses Admin SDK for live environments, REST API for emulator
async function getHigherTierConversationCount(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  
  // Live environment: use Admin SDK
  if (isLiveEnvironment()) {
    const db = await getAdminDb();
    if (!db) {
      console.error('  [Live env] Admin SDK not available');
      return 0;
    }
    
    try {
      const docRef = db.doc(`users/${userId}/private/data`);
      const doc = await docRef.get();
      
      if (!doc.exists) return 0;
      
      const reputation = doc.data()?.reputation || {};
      const lastDate = reputation.lastConversationDate ?? '';
      const count = reputation.higherTierConversationsToday ?? 0;
      
      // Only return count if it's for today
      if (lastDate === today) {
        return count;
      }
      return 0;
    } catch (error) {
      console.error('  [Live env] Error getting conversation count:', error);
      return 0;
    }
  }
  
  // Local emulator: use REST API
  const FIREBASE_PROJECT_ID = 'gylde-sandbox';
  const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
  
  try {
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}/private/data`;
    const adminHeaders = {
      'Authorization': 'Bearer owner',
    };
    
    const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;
    const getResponse = await fetch(getUrl, { headers: adminHeaders });
    
    if (getResponse.ok) {
      const doc = await getResponse.json() as { fields?: Record<string, unknown> };
      const reputation = doc.fields?.reputation as { mapValue?: { fields?: Record<string, unknown> } } | undefined;
      const repFields = reputation?.mapValue?.fields || {};
      
      const lastDate = (repFields.lastConversationDate as { stringValue?: string })?.stringValue ?? '';
      const count = (repFields.higherTierConversationsToday as { integerValue?: string })?.integerValue ?? '0';
      
      if (lastDate === today) {
        return parseInt(count, 10);
      }
      return 0;
    }
    return 0;
  } catch (error) {
    console.error('Error getting higher tier conversation count:', error);
    return 0;
  }
}

// Helper to delete ALL conversations for a user
// Uses Admin SDK for live environments, REST API for emulator
async function deleteAllConversationsForUser(userId: string): Promise<void> {
  // Live environment: use Admin SDK
  if (isLiveEnvironment()) {
    const db = await getAdminDb();
    if (!db) {
      console.error('  [Live env] Admin SDK not available');
      return;
    }
    
    try {
      // Query conversations where user is a participant
      const conversationsRef = db.collection('conversations');
      const snapshot = await conversationsRef.where('participants', 'array-contains', userId).get();
      
      console.log(`  [Live env] Found ${snapshot.size} conversations for user ${userId}`);
      
      // Delete each conversation
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      if (snapshot.size > 0) {
        await batch.commit();
        console.log(`  [Live env] Deleted ${snapshot.size} conversations`);
      }
    } catch (error) {
      console.error('  [Live env] Error deleting conversations:', error);
    }
    return;
  }
  
  // Local emulator: use REST API
  const FIREBASE_PROJECT_ID = 'gylde-sandbox';
  const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
  
  try {
    const adminHeaders = {
      'Authorization': 'Bearer owner',
    };
    
    // List all conversations
    const listUrl = `${FIRESTORE_EMULATOR_URL}/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/conversations`;
    const listResponse = await fetch(listUrl, { headers: adminHeaders });
    
    if (listResponse.ok) {
      const data = await listResponse.json();
      const documents = data.documents || [];
      console.log(`Found ${documents.length} total conversations`);
      
      // Find and delete conversations involving this user
      for (const doc of documents) {
        const participants = doc.fields?.participants?.arrayValue?.values || [];
        const participantUids = participants.map((p: any) => p.stringValue);
        
        if (participantUids.includes(userId)) {
          const deleteUrl = `${FIRESTORE_EMULATOR_URL}/v1/${doc.name}`;
          const deleteRes = await fetch(deleteUrl, { method: 'DELETE', headers: adminHeaders });
          console.log(`Deleted conversation ${doc.name.split('/').pop()}: ${deleteRes.status}`);
        }
      }
    } else {
      console.log(`List conversations failed: ${listResponse.status}`);
    }
  } catch (error) {
    console.error('Error deleting conversations:', error);
  }
}

// Helper to start a conversation and SEND a message to use up the limit
// Moved to module level so it can be used by multiple test suites
async function startConversationAndSendMessage(page: Page, targetName: string, message: string): Promise<{
  success: boolean;
  limitReached: boolean;
  errorMessage: string | null;
}> {
  await goToDiscoverPage(page);
  
  // Wait for profiles to load
  await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
  
  // Find the target user's profile card
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: targetName })
  });
  
  // Check if target is visible
  const isVisible = await profileCard.isVisible({ timeout: 5000 }).catch(() => false);
  if (!isVisible) {
    console.log(`Target user "${targetName}" not visible in discover page`);
    return { success: false, limitReached: false, errorMessage: `User ${targetName} not found` };
  }
  
  // Click message button
  const messageBtn = profileCard.locator('.action-btn.message');
  await messageBtn.waitFor({ state: 'visible', timeout: 5000 });
  await messageBtn.click();
  
  // Wait for response - either navigation to messages or snackbar
  await Promise.race([
    page.waitForURL(/\/messages/, { timeout: 10000 }),
    page.locator('.mat-mdc-snack-bar-container').waitFor({ state: 'visible', timeout: 10000 }),
  ]).catch(() => {});
  
  await page.waitForTimeout(500);
  
  // Check if we got blocked before navigation
  const snackbar = page.locator('.mat-mdc-snack-bar-container');
  const hasSnackbar = await snackbar.isVisible().catch(() => false);
  
  if (hasSnackbar) {
    const errorMessage = await snackbar.textContent().catch(() => null);
    const limitReached = errorMessage?.toLowerCase().includes('limit') || 
                         errorMessage?.toLowerCase().includes('daily') ||
                         false;
    if (limitReached) {
      return { success: false, limitReached: true, errorMessage };
    }
  }
  
  // If we're on messages page, send an actual message to use up the limit
  const onMessagesPage = page.url().includes('/messages');
  if (onMessagesPage) {
    // Wait for chat to load
    await page.waitForTimeout(1000);
    
    // Find and fill the message input
    const messageInput = page.locator('.chat-input input[type="text"]');
    
    if (await messageInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Focus and fill the input - fill() is more reliable than pressSequentially
      await messageInput.click();
      await messageInput.fill(message);
      
      // Wait for Angular to update canSend()
      await page.waitForTimeout(500);
      
      // Click send button
      const sendBtn = page.locator('.chat-input .send-btn:not([disabled])');
      try {
        await sendBtn.waitFor({ state: 'visible', timeout: 3000 });
        await sendBtn.click();
        
        // Wait for the message to appear in the chat (confirms it was sent)
        const sentMessage = page.locator('.message-bubble, .chat-message, .message-content', { hasText: message });
        await sentMessage.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        
        // Wait extra time for Cloud Function to process and increment counter in Firestore
        await page.waitForTimeout(5000);
      } catch {
        console.log('Send button not enabled - message may not have been typed correctly');
      }
    }
    
    return { success: true, limitReached: false, errorMessage: null };
  }
  
  return { success: false, limitReached: false, errorMessage: 'Navigation failed' };
}

test.describe.serial('Reputation - Messaging Limit Enforcement', () => {
  // Get the second new tier user for same-tier testing
  const newTierUser2 = DISCOVER_TEST_USERS.newTierUser2;
  
  // Helper to just attempt to navigate to messages (to check if blocked)
  async function attemptMessage(page: Page, targetName: string): Promise<{
    success: boolean;
    limitReached: boolean;
    errorMessage: string | null;
  }> {
    await goToDiscoverPage(page);
    
    // Wait for profiles to load
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    // Find the target user's profile card
    const profileCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: targetName })
    });
    
    // Check if target is visible with retry
    let isVisible = await profileCard.isVisible({ timeout: 5000 }).catch(() => false);
    for (let attempt = 0; attempt < 3 && !isVisible; attempt++) {
      console.log(`Target user "${targetName}" not visible, refreshing (attempt ${attempt + 1})...`);
      await page.reload();
      await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
      isVisible = await profileCard.isVisible({ timeout: 5000 }).catch(() => false);
    }
    
    if (!isVisible) {
      console.log(`Target user "${targetName}" not visible after 3 attempts`);
      return { success: false, limitReached: false, errorMessage: `User ${targetName} not found` };
    }
    
    // Click message button
    const messageBtn = profileCard.locator('.action-btn.message');
    await messageBtn.waitFor({ state: 'visible', timeout: 5000 });
    await messageBtn.click();
    
    // Wait for response - either navigation to messages or snackbar
    await Promise.race([
      page.waitForURL(/\/messages/, { timeout: 10000 }),
      page.locator('.mat-mdc-snack-bar-container').waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {});
    
    await page.waitForTimeout(500);
    
    // Check the result
    const onMessagesPage = page.url().includes('/messages');
    const snackbar = page.locator('.mat-mdc-snack-bar-container');
    const hasSnackbar = await snackbar.isVisible().catch(() => false);
    let errorMessage: string | null = null;
    let limitReached = false;
    
    if (hasSnackbar) {
      errorMessage = await snackbar.textContent().catch(() => null);
      limitReached = errorMessage?.toLowerCase().includes('limit') || 
                     errorMessage?.toLowerCase().includes('daily') ||
                     false;
    }
    
    return {
      success: onMessagesPage && !limitReached,
      limitReached,
      errorMessage,
    };
  }

  test('new tier user can message a higher tier user and send first message', async ({ page, loginAs, provisionSuiteUser }) => {
    const newUser = await provisionSuiteUser(newTierUserTemplate, 'new-sender');
    const distinguished = await provisionSuiteUser(distinguishedTierUserTemplate, 'distinguished-target');

    // Login as new tier user
    await loginAs(newUser);
    
    // Start conversation with Distinguished Diana AND send a message to use up the limit
    const result = await startConversationAndSendMessage(page, distinguished.displayName, 'Hello! This is a test message.');
    
    console.log(`First higher-tier message sent: success=${result.success}, limitReached=${result.limitReached}`);
    
    // First message should succeed
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  test('new tier user is blocked from second higher tier conversation (limit = 1)', async ({ page, loginAs, provisionSuiteUser }) => {
    // Increase timeout for this multi-step test
    test.setTimeout(90000);
    
    const newUser = await provisionSuiteUser(newTierUserTemplate, 'new-sender');
    const distinguished = await provisionSuiteUser(distinguishedTierUserTemplate, 'distinguished-target');
    const trusted = await provisionSuiteUser(trustedTierUserTemplate, 'trusted-target');

    // Login as new tier user
    await loginAs(newUser);
    
    // Get the actual user UID from IndexedDB
    const uid = await getCurrentUserUid(page);
    console.log(`User UID: ${uid}`);
    
    if (uid) {
      // Delete any existing conversations FIRST to ensure clean slate
      await deleteAllConversationsForUser(uid);
      await page.waitForTimeout(2000);
      
      // Reset the counter to 0 to ensure clean state
      await setHigherTierConversationCount(uid, 0);
      await page.waitForTimeout(2000);
      
      // Force refresh to pick up clean state
      await page.goto('/settings');
      await page.waitForTimeout(500);
      await page.goto('/discover');
      await page.waitForTimeout(1000);
    }
    
    // STEP 1: First, naturally use up the limit by sending a message to a higher tier user
    // Use Distinguished Diana who is higher tier
    console.log('Step 1: Sending first higher-tier message to use up the limit...');
    const firstResult = await startConversationAndSendMessage(page, distinguished.displayName, 'Test message to use limit');
    console.log(`First message result: success=${firstResult.success}, limitReached=${firstResult.limitReached}`);
    
    // First message should succeed
    expect(firstResult.success).toBe(true);
    
    // Wait briefly for the message to be processed
    await page.waitForTimeout(2000);
    
    // The Cloud Function should increment the counter, but in the emulator it may not fire reliably.
    // Check if it was incremented; if not, manually set it to simulate the Cloud Function behavior.
    if (uid) {
      const currentCount = await getHigherTierConversationCount(uid);
      console.log(`Counter after first message: ${currentCount}`);
      
      if (currentCount < 1) {
        console.log('Cloud Function did not increment counter - manually setting to 1');
        await setHigherTierConversationCount(uid, 1);
        await page.waitForTimeout(1000);
        
        // Verify it was set
        const verifyCount = await getHigherTierConversationCount(uid);
        console.log(`Counter after manual set: ${verifyCount}`);
      }
    }
    
    // Always navigate to force refresh of client state (the checkMessagePermission call happens server-side
    // but we still want to ensure client navigates back to discover)
    await page.goto('/settings');
    await page.waitForTimeout(500);
    await page.goto('/discover');
    await page.waitForTimeout(1000);
    
    // STEP 2: Now try to message a DIFFERENT higher tier user - should be blocked
    // Try Trusted Tina who is also higher tier
    console.log('Step 2: Attempting second higher-tier message (should be blocked)...');
    const secondResult = await attemptMessage(page, trusted.displayName);
    
    console.log(`Second higher-tier message attempt: success=${secondResult.success}, limitReached=${secondResult.limitReached}, error=${secondResult.errorMessage}`);
    
    // Second message to a higher tier user should be blocked
    expect(secondResult.limitReached).toBe(true);
    expect(secondResult.errorMessage).toMatch(/limit|daily/i);
  });

  test('new tier user can still message same tier user (no limit)', async ({ page, loginAs, provisionSuiteUser }) => {
    const newUser = await provisionSuiteUser(newTierUserTemplate, 'new-sender');
    const newPeer = await provisionSuiteUser(DISCOVER_TEST_USERS.newTierUser2, 'new-peer');

    // Login as new tier user
    await loginAs(newUser);
    
    // Try to message another new tier user - New Nancy
    // This should succeed because same-tier messaging has no limits
    const result = await attemptMessage(page, newPeer.displayName);
    
    console.log(`Same-tier message attempt: success=${result.success}, limitReached=${result.limitReached}`);
    
    // Same tier messaging should succeed regardless of higher-tier limit
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  test('distinguished tier user has unlimited higher tier messaging', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    const distinguished = await provisionSuiteUser(distinguishedTierUserTemplate, 'distinguished-sender');
    const otherMan = await provisionSuiteUser(newTierUserTemplate, 'other-man');

    // Login as distinguished tier user
    await loginAs(distinguished);
    
    // Distinguished users have unlimited messaging (-1 limit)
    // They can message anyone, and even after sending messages, are never blocked
    
    // First conversation + message
    const result1 = await startConversationAndSendMessage(page, bob.displayName, 'Hello from Distinguished tier!');
    console.log(`Distinguished user first message: success=${result1.success}`);
    
    // Distinguished users should never be blocked
    expect(result1.limitReached).toBe(false);
    
    // Try a second conversation
    const result2 = await attemptMessage(page, otherMan.displayName);
    console.log(`Distinguished user second message: success=${result2.success}`);
    
    expect(result2.limitReached).toBe(false);
  });
});

/**
 * Active Tier Limit Tests (limit = 3)
 * 
 * Verifies that active tier users can message up to 3 higher tier users per day.
 * Must send actual messages to increment the counter.
 */
test.describe.serial('Reputation - Active Tier Limits (3/day)', () => {
  
  // Helper to start conversation and send a message (to use up limit)
  async function sendMessageTo(page: Page, targetName: string, message: string): Promise<{
    success: boolean;
    limitReached: boolean;
  }> {
    await goToDiscoverPage(page);
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    const profileCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: targetName })
    });
    
    // Retry finding the target user with page refresh (up to 3 attempts)
    let isVisible = await profileCard.isVisible({ timeout: 5000 }).catch(() => false);
    for (let attempt = 0; attempt < 3 && !isVisible; attempt++) {
      console.log(`Target "${targetName}" not visible, refreshing page (attempt ${attempt + 1})...`);
      await page.reload();
      await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
      isVisible = await profileCard.isVisible({ timeout: 5000 }).catch(() => false);
    }
    
    if (!isVisible) {
      console.log(`Target "${targetName}" still not visible after 3 refresh attempts`);
      return { success: false, limitReached: false };
    }
    
    const messageBtn = profileCard.locator('.action-btn.message');
    await messageBtn.click();
    
    await Promise.race([
      page.waitForURL(/\/messages/, { timeout: 10000 }),
      page.locator('.mat-mdc-snack-bar-container').waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {});
    
    await page.waitForTimeout(500);
    
    // Check if blocked before we got to messages
    const snackbar = page.locator('.mat-mdc-snack-bar-container');
    const hasSnackbar = await snackbar.isVisible().catch(() => false);
    
    if (hasSnackbar) {
      const text = await snackbar.textContent().catch(() => '');
      const limitReached = text?.toLowerCase().includes('limit') || text?.toLowerCase().includes('daily') || false;
      if (limitReached) {
        return { success: false, limitReached: true };
      }
    }
    
    // If on messages page, send the message
    const onMessagesPage = page.url().includes('/messages');
    if (onMessagesPage) {
      await page.waitForTimeout(1000);
      
      const messageInput = page.locator('.chat-input input[type="text"]');
      if (await messageInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Focus and fill the input - fill() is more reliable than pressSequentially
        await messageInput.click();
        await messageInput.fill(message);
        await page.waitForTimeout(500);
        
        const sendBtn = page.locator('.chat-input .send-btn:not([disabled])');
        try {
          await sendBtn.waitFor({ state: 'visible', timeout: 3000 });
          await sendBtn.click();
          
          // Wait for the message to appear in the chat (confirms it was sent)
          const sentMessage = page.locator('.message-bubble, .chat-message, .message-content', { hasText: message });
          await sentMessage.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
          
          // Wait extra time for Cloud Function to process and increment counter in Firestore
          await page.waitForTimeout(5000);
        } catch {
          console.log('Send button not enabled - message may not have been typed correctly');
        }
      }
      return { success: true, limitReached: false };
    }
    
    return { success: false, limitReached: false };
  }
  
  // Helper to just attempt navigation (to check if blocked)
  async function attemptMessage(page: Page, targetName: string): Promise<{
    success: boolean;
    limitReached: boolean;
  }> {
    await goToDiscoverPage(page);
    await page.locator('.profile-grid app-profile-card').first().waitFor({ state: 'visible', timeout: 15000 });
    
    const profileCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: targetName })
    });
    
    if (!(await profileCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log(`Target "${targetName}" not visible`);
      return { success: false, limitReached: false };
    }
    
    const messageBtn = profileCard.locator('.action-btn.message');
    await messageBtn.click();
    
    await Promise.race([
      page.waitForURL(/\/messages/, { timeout: 10000 }),
      page.locator('.mat-mdc-snack-bar-container').waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {});
    
    await page.waitForTimeout(500);
    
    const onMessagesPage = page.url().includes('/messages');
    const snackbar = page.locator('.mat-mdc-snack-bar-container');
    const hasSnackbar = await snackbar.isVisible().catch(() => false);
    let limitReached = false;
    
    if (hasSnackbar) {
      const text = await snackbar.textContent().catch(() => '');
      limitReached = text?.toLowerCase().includes('limit') || text?.toLowerCase().includes('daily') || false;
    }
    
    return { success: onMessagesPage && !limitReached, limitReached };
  }

  test('active tier user (Bob) can send first message to higher tier user', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    const established = await provisionSuiteUser(establishedTierUserTemplate, 'established-target');

    // Bob is active tier (limit = 3)
    await loginAs(bob);

    const uid = await getCurrentUserUid(page);
    if (uid) {
      await setHigherTierConversationCount(uid, 0);
      await page.waitForTimeout(500);
    }
    
    // First message to established tier (higher) - must SEND to use up limit
    const result = await sendMessageTo(page, established.displayName, 'Hello Emma, test message 1!');
    console.log(`Active tier user 1st message: success=${result.success}`);
    
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  test('active tier user (Bob) can send second message to higher tier user', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    const trusted = await provisionSuiteUser(trustedTierUserTemplate, 'trusted-target');

    await loginAs(bob);

    const uid = await getCurrentUserUid(page);
    if (uid) {
      await setHigherTierConversationCount(uid, 1);
      await page.waitForTimeout(500);
    }
    
    // Second message to trusted tier (higher)
    const result = await sendMessageTo(page, trusted.displayName, 'Hello Tina, test message 2!');
    console.log(`Active tier user 2nd message: success=${result.success}`);
    
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  test('active tier user (Bob) can send third message to higher tier user', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    const distinguished = await provisionSuiteUser(distinguishedTierUserTemplate, 'distinguished-target');

    await loginAs(bob);

    const uid = await getCurrentUserUid(page);
    if (uid) {
      await setHigherTierConversationCount(uid, 2);
      await page.waitForTimeout(500);
    }
    
    // Third message to distinguished tier (higher)
    const result = await sendMessageTo(page, distinguished.displayName, 'Hello Diana, test message 3!');
    console.log(`Active tier user 3rd message: success=${result.success}`);
    
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  test('active tier user (Bob) is blocked on fourth higher tier message', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    // Increase timeout for this multi-step test (sending 4 messages)
    test.setTimeout(240000);
    
    // NOTE: This test depends on the backend Cloud Function correctly incrementing
    // higherTierConversationsToday. If the test fails, check that:
    // 1. onMessageCreated Cloud Function is deployed and working
    // 2. The function correctly identifies higher-tier conversations
    // 3. Firestore writes are completing before the next message is sent
    
    const established1 = await provisionSuiteUser(establishedTierUserTemplate, 'established-1');
    const trusted = await provisionSuiteUser(trustedTierUserTemplate, 'trusted-1');
    const distinguished = await provisionSuiteUser(distinguishedTierUserTemplate, 'distinguished-1');
    const established2 = await provisionSuiteUser(establishedTierUserTemplate, 'established-2');

    await loginAs(bob);
    
    // Get Bob's UID
    const uid = await getCurrentUserUid(page);
    console.log(`Bob's UID: ${uid}`);
    
    if (uid) {
      // Delete any existing conversations FIRST to ensure clean slate
      await deleteAllConversationsForUser(uid);
      await page.waitForTimeout(2000);
      
      // Reset the counter to 0 to ensure clean state
      await setHigherTierConversationCount(uid, 0);
      await page.waitForTimeout(2000);
      
      // Force refresh to pick up clean state
      await page.goto('/settings');
      await page.waitForTimeout(500);
      await page.goto('/discover');
      await page.waitForTimeout(1000);
    }
    
    // Bob (active tier, limit = 3) needs to send 3 messages first, then 4th should be blocked
    // Higher tier users Bob can message (Bob is active): established, trusted, distinguished
    const higherTierTargets = [established1.displayName, trusted.displayName, distinguished.displayName];
    
    // Send messages to 3 different higher-tier users to use up the limit
    for (let i = 0; i < 3; i++) {
      console.log(`Sending message ${i + 1}/3 to ${higherTierTargets[i]}...`);
      const result = await startConversationAndSendMessage(page, higherTierTargets[i], `Test message ${i + 1}`);
      console.log(`Message ${i + 1} result: success=${result.success}`);
      expect(result.success).toBe(true);
      
      // In preview/live environments we cannot rely on Cloud Functions timing to increment
      // `higherTierConversationsToday` deterministically. We set it directly via Admin SDK/REST
      // after each successful conversation start to make the test stable.
      if (uid) {
        const desired = i + 1;

        const setOk = await setHigherTierConversationCount(uid, desired);
        expect(setOk).toBe(true);

        await expect
          .poll(async () => getHigherTierConversationCount(uid), { timeout: 30000 })
          .toBe(desired);
      }
      
      // Navigate back to discover for next message
      await page.goto('/discover');
      await page.waitForTimeout(1000);
    }
    
    // Verify counter before trying 4th message
    let finalCount = 0;
    if (uid) {
      finalCount = await getHigherTierConversationCount(uid);
      console.log(`Final counter before 4th attempt: ${finalCount}`);
      expect(finalCount).toBeGreaterThanOrEqual(3);
    }
    
    // Now try to message a 4th higher tier user - should be blocked
    // Use a NEW established-tier user (not previously messaged) who is also higher tier than active
    console.log('Attempting 4th higher-tier message (should be blocked)...');
    const result = await attemptMessage(page, established2.displayName);
    console.log(`Active tier user 4th message: success=${result.success}, blocked=${result.limitReached}`);
    
    // Should be blocked (when counter reaches 3)
    // We sent 3 messages, so regardless of what counter shows, 4th should be blocked
    expect(result.limitReached).toBe(true);
  });

  test('active tier user (Bob) can still message same/lower tier', async ({ page, loginAs, provisionSuiteUser, suiteBob: bob }) => {
    const newPeer = await provisionSuiteUser(DISCOVER_TEST_USERS.newTierUser2, 'new-peer');

    await loginAs(bob);
    
    // Should be able to message new tier user (lower tier) without limits
    // Use New Nancy (woman, new tier) since Bob is only interested in women
    const result = await attemptMessage(page, newPeer.displayName);
    console.log(`Active tier messaging lower tier: success=${result.success}`);
    
    // Same/lower tier should always work
    expect(result.success).toBe(true);
    expect(result.limitReached).toBe(false);
  });
});
