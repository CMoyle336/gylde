import { expect, Locator, Page } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from e2e/.env (for live env Admin SDK)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Control verbose logging via environment variable
const DEBUG = process.env.E2E_DEBUG === 'true';

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

// Firebase Admin SDK - lazy loaded for live environments (used to verify/persist settings)
let adminDb: any | null = null;
let adminInitialized = false;
let adminAuth: any | null = null;
let adminAuthInitialized = false;

export async function getAdminDb(): Promise<any | null> {
  // For emulator environments, we can use REST API directly - don't need Admin SDK
  if (!isLiveEnvironment()) return null;
  if (adminInitialized) return adminDb;

  try {
    const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');

    if (getApps().length === 0) {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox',
      });
    }

    adminDb = getFirestore();
    adminInitialized = true;
    debugLog('[AdminSDK] Firestore initialized successfully');
    return adminDb;
  } catch (error) {
    debugLog('[AdminSDK] ❌ Failed to initialize Firestore:', error);
    adminInitialized = true;
    return null;
  }
}

export async function getAdminAuth(): Promise<any | null> {
  // For emulator environments, we can use REST API directly - don't need Admin SDK
  if (!isLiveEnvironment()) return null;
  if (adminAuthInitialized) return adminAuth;

  try {
    const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');

    if (getApps().length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
      console.log(`[AdminSDK] Initializing with project: ${projectId}`);
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }

    adminAuth = getAuth();
    adminAuthInitialized = true;
    debugLog('[AdminSDK] Auth initialized successfully');
    return adminAuth;
  } catch (error) {
    debugLog('[AdminSDK] ❌ Failed to initialize Auth:', error);
    adminAuthInitialized = true;
    return null;
  }
}

export async function getUidByEmail(email: string): Promise<string | null> {
  const auth = await getAdminAuth();
  if (!auth) return null;
  try {
    const user = await auth.getUserByEmail(email);
    return user?.uid || null;
  } catch {
    return null;
  }
}

export async function getCurrentUserUid(page: Page): Promise<string | null> {
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
                db.close();
                resolve(null);
              };
              getAllRequest.onerror = () => {
                db.close();
                resolve(null);
              };
            } catch {
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
        setTimeout(() => resolve(null), 2000);
      });
    });
    return uid;
  } catch {
    return null;
  }
}

export async function verifyUserShowOnlineStatus(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.privacy?.showOnlineStatus === expected;
}

export async function verifyUserShowLastActive(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.privacy?.showLastActive === expected;
}

export async function verifyUserProfileVisible(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.privacy?.profileVisible === expected;
}

export async function verifyUserShowLocation(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.privacy?.showLocation === expected;
}

export async function verifyUserCreateOnView(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.activity?.createOnView === expected;
}

export async function verifyUserCreateOnFavorite(uid: string, expected: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() as any;
  return data?.settings?.activity?.createOnFavorite === expected;
}

export async function forceSetUserShowOnlineStatus(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { privacy: { showOnlineStatus: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserShowOnlineStatus(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserShowLastActive(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { privacy: { showLastActive: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserShowLastActive(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserProfileVisible(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { privacy: { profileVisible: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserProfileVisible(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserShowLocation(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { privacy: { showLocation: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserShowLocation(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserCreateOnView(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { activity: { createOnView: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserCreateOnView(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserCreateOnFavorite(uid: string, value: boolean): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  await db.doc(`users/${uid}`).set({ settings: { activity: { createOnFavorite: value } } }, { merge: true });

  await expect
    .poll(async () => verifyUserCreateOnFavorite(uid, value), { timeout: 30000 })
    .toBe(true);

  return true;
}

export async function forceSetUserLastActiveMinutesAgo(uid: string, minutesAgo: number): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) return false;

  const when = new Date(Date.now() - minutesAgo * 60 * 1000);
  await db.doc(`users/${uid}`).set(
    { lastActiveAt: when, sortableLastActive: when },
    { merge: true }
  );

  return true;
}

export async function goToSettingsPage(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.settings-content').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
}

export async function waitForSettingsSave(page: Page): Promise<void> {
  const savingIndicator = page.locator('.saving-indicator');
  const timeoutMs = isLiveEnvironment() ? 45000 : 20000;

  // The indicator is only rendered while the Settings page's `saving()` signal is true.
  // In live/CI environments Firestore writes can be slow, so we use a longer timeout.
  // If the UI gets stuck in a "saving" state, we do a single best-effort reload to
  // unstick the UI before failing the test.
  try {
    await savingIndicator.waitFor({ state: 'hidden', timeout: timeoutMs });
  } catch (err) {
    // Best-effort recovery: reload once and re-check.
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await savingIndicator.waitFor({ state: 'hidden', timeout: 15000 });
    // If we got here, the UI is no longer stuck; continue the test.
  }

  await page.waitForTimeout(500);
}

export async function goToDiscoverPage(page: Page): Promise<void> {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

export async function goToMatchesPage(page: Page): Promise<void> {
  await page.goto('/matches');
  await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

export async function goToMessagesPage(page: Page): Promise<void> {
  await page.goto('/messages');
  await page.locator('app-messages, .messages-page').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);

  const logoutItem = page.locator('.setting-item', { has: page.locator('.logout-icon') });
  await logoutItem.first().scrollIntoViewIfNeeded().catch(() => {});
  await logoutItem.first().waitFor({ state: 'visible', timeout: 15000 });
  const dialogOverlay = page.locator('.dialog-overlay').first();

  // If a dialog is already open, don't click behind it (it will intercept pointer events).
  const overlayAlreadyVisible = await dialogOverlay.isVisible().catch(() => false);
  if (!overlayAlreadyVisible) {
    await logoutItem.first().click();
  }

  // Our app sometimes renders the sign-out prompt inside a generic overlay. Prefer a specific
  // dialog root, but fall back to the overlay if that's what exists.
  const logoutDialog = page.locator('.logout-dialog').first();
  await expect
    .poll(
      async () =>
        (await logoutDialog.isVisible().catch(() => false)) || (await dialogOverlay.isVisible().catch(() => false)),
      { timeout: 15000 }
    )
    .toBe(true);

  const dialogRoot = (await logoutDialog.isVisible().catch(() => false)) ? logoutDialog : dialogOverlay;

  const confirmBtn = dialogRoot
    .locator(
      [
        'button[color="warn"]',
        'button:has-text("Sign Out")',
        'button:has-text("Sign out")',
        'button:has-text("Logout")',
        'button:has-text("Log out")',
      ].join(', ')
    )
    .first();

  await confirmBtn.waitFor({ state: 'visible', timeout: 15000 });
  await confirmBtn.click();

  await page.waitForURL('/', { timeout: 30000 });
  await page.waitForTimeout(500);
}

export function getMaterialToggleSwitch(toggle: Locator): Locator {
  return toggle.locator('button[role="switch"], [role="switch"]').first();
}

export async function isMaterialToggleChecked(toggleSwitch: Locator, toggleRoot?: Locator): Promise<boolean> {
  const ariaChecked = await toggleSwitch.getAttribute('aria-checked');
  if (ariaChecked === 'true') return true;
  if (ariaChecked === 'false') return false;

  if (toggleRoot) {
    return await toggleRoot.evaluate((el) => {
      const cls = (el as HTMLElement).classList;
      return cls.contains('mat-mdc-slide-toggle-checked') || cls.contains('mat-checked');
    });
  }

  return false;
}

export async function setMaterialToggle(toggleRoot: Locator, toggleSwitch: Locator, enable: boolean): Promise<void> {
  await toggleSwitch.waitFor({ state: 'visible', timeout: 15000 });

  const current = await isMaterialToggleChecked(toggleSwitch, toggleRoot);
  if (current === enable) return;

  await toggleSwitch.click();

  await expect
    .poll(async () => isMaterialToggleChecked(toggleSwitch, toggleRoot), { timeout: 15000 })
    .toBe(enable);
}

export async function getOnlineStatusToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const firstSettingItem = settingsGroup.locator('.setting-item').first();
  await firstSettingItem.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = firstSettingItem.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function getLastActiveToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const lastActiveItem = settingsGroup.locator('.setting-item').filter({
    has: page.locator('.setting-label', { hasText: /last active/i }),
  }).first();

  const item = (await lastActiveItem.count()) > 0 ? lastActiveItem : settingsGroup.locator('.setting-item').nth(1);
  await item.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = item.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function getProfileVisibilityToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const profileVisibilityItem = settingsGroup
    .locator('.setting-item')
    .filter({
      has: page.locator('.setting-label', { hasText: /profile visibility/i }),
    })
    .first();

  // Fallback to the 3rd privacy setting (online status, last active, profile visibility)
  const item =
    (await profileVisibilityItem.count()) > 0 ? profileVisibilityItem : settingsGroup.locator('.setting-item').nth(2);

  await item.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = item.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function getShowLocationToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const showLocationItem = settingsGroup
    .locator('.setting-item')
    .filter({
      has: page.locator('.setting-label', { hasText: /show location/i }),
    })
    .first();

  // Fallback to the 4th privacy setting (online status, last active, profile visibility, show location)
  const item = (await showLocationItem.count()) > 0 ? showLocationItem : settingsGroup.locator('.setting-item').nth(3);

  await item.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = item.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function getProfileViewNotificationsToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const viewNotifItem = settingsGroup
    .locator('.setting-item')
    .filter({
      has: page.locator('.setting-label', { hasText: /view notifications/i }),
    })
    .first();

  // Fallback to the 5th item in the privacy group.
  const item = (await viewNotifItem.count()) > 0 ? viewNotifItem : settingsGroup.locator('.setting-item').nth(4);
  await item.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = item.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function getFavoriteNotificationsToggle(page: Page): Promise<{ toggle: Locator; toggleSwitch: Locator }> {
  await page.locator('.settings-section').first().waitFor({ state: 'visible', timeout: 15000 });
  const privacySection = page.locator('.settings-section').nth(1);
  await privacySection.waitFor({ state: 'visible', timeout: 15000 });

  const settingsGroup = privacySection.locator('.settings-group');
  await settingsGroup.waitFor({ state: 'visible', timeout: 10000 });

  const favoriteNotifItem = settingsGroup
    .locator('.setting-item')
    .filter({
      has: page.locator('.setting-label', { hasText: /favorite notifications/i }),
    })
    .first();

  // Fallback to the 6th item in the privacy group.
  const item =
    (await favoriteNotifItem.count()) > 0 ? favoriteNotifItem : settingsGroup.locator('.setting-item').nth(5);
  await item.waitFor({ state: 'visible', timeout: 10000 });

  const toggle = item.locator('mat-slide-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 10000 });

  const toggleSwitch = getMaterialToggleSwitch(toggle);
  await toggleSwitch.waitFor({ state: 'visible', timeout: 10000 });

  return { toggle, toggleSwitch };
}

export async function viewUserProfile(page: Page, displayName: string): Promise<void> {
  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName }),
  });

  await profileCard.waitFor({ state: 'visible', timeout: 10000 });
  await profileCard.locator('.action-btn.view').click();
  await page.locator('.user-profile-page').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

export async function startConversation(page: Page, displayName: string): Promise<void> {
  await goToDiscoverPage(page);

  const profileCard = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName }),
  });

  await profileCard.waitFor({ state: 'visible', timeout: 30000 });
  await profileCard.locator('.action-btn.message').click();
  await page.waitForURL(/\/messages/, { timeout: 15000 });
  await page.waitForTimeout(1000);
}

