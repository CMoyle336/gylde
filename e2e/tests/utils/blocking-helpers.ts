import { expect, Page } from '@playwright/test';
import { getAdminDb } from './settings-helpers';

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

export async function adminEnsureUnblocked(uidA: string, uidB: string): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;

  // Remove both directions if present
  await Promise.allSettled([
    db.doc(`users/${uidA}/blocks/${uidB}`).delete(),
    db.doc(`users/${uidA}/blockedBy/${uidB}`).delete(),
    db.doc(`users/${uidB}/blocks/${uidA}`).delete(),
    db.doc(`users/${uidB}/blockedBy/${uidA}`).delete(),
  ]);
}

export async function adminClearAllBlocksForUser(uid: string): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;

  const deleteAllInSubcollection = async (subPath: string) => {
    const snap = await db.collection(subPath).get();
    if (snap.empty) return;
    // Delete in chunks to avoid batch limits.
    for (let i = 0; i < snap.docs.length; i += 450) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + 450)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  };

  await Promise.allSettled([
    deleteAllInSubcollection(`users/${uid}/blocks`),
    deleteAllInSubcollection(`users/${uid}/blockedBy`),
  ]);
}

export async function adminSeedFavorite(uidFrom: string, uidTo: string): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;
  await db.doc(`users/${uidFrom}/favorites/${uidTo}`).set(
    {
      fromUserId: uidFrom,
      toUserId: uidTo,
      createdAt: new Date(),
      private: false,
    },
    { merge: true }
  );
}

export async function adminSeedProfileView(uidViewer: string, uidViewed: string): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;
  await db.collection('profileViews').add({
    viewerId: uidViewer,
    viewerName: 'Someone',
    viewerPhoto: null,
    viewedUserId: uidViewed,
    viewedAt: new Date(),
  });
}

export async function adminSeedActivity(opts: {
  recipientUid: string;
  fromUid: string;
  type: 'favorite' | 'view';
  fromUserName: string;
}): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;
  await db.collection(`users/${opts.recipientUid}/activities`).add({
    type: opts.type,
    fromUserId: opts.fromUid,
    fromUserName: opts.fromUserName,
    fromUserPhoto: null,
    toUserId: opts.recipientUid,
    read: false,
    link: `/user/${opts.fromUid}`,
    createdAt: new Date(),
  });
}

export async function adminExpectCleanupBetweenUsers(uidA: string, uidB: string): Promise<void> {
  const db = await getAdminDb();
  if (!db) return;
  const timeoutMs = isLiveEnvironment() ? 120000 : 30000;

  // Favorites
  await expect
    .poll(async () => (await db.doc(`users/${uidA}/favorites/${uidB}`).get()).exists, { timeout: timeoutMs })
    .toBe(false);
  await expect
    .poll(async () => (await db.doc(`users/${uidB}/favorites/${uidA}`).get()).exists, { timeout: timeoutMs })
    .toBe(false);

  // Activities (deleteActivitiesBetweenUsers queries by fromUserId)
  const countActivitiesFrom = async (recipient: string, from: string) => {
    const snap = await db.collection(`users/${recipient}/activities`).where('fromUserId', '==', from).get();
    return snap.size;
  };
  await expect.poll(async () => countActivitiesFrom(uidA, uidB), { timeout: timeoutMs }).toBe(0);
  await expect.poll(async () => countActivitiesFrom(uidB, uidA), { timeout: timeoutMs }).toBe(0);

  // Matches
  const countMatchesBetween = async () => {
    const snap = await db.collection('matches').where('users', 'array-contains', uidA).get();
    let count = 0;
    for (const doc of snap.docs) {
      const users = (doc.data().users || []) as string[];
      if (users.includes(uidB)) count++;
    }
    return count;
  };
  await expect.poll(countMatchesBetween, { timeout: timeoutMs }).toBe(0);
}

export async function openManageBlockedUsers(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30000 });

  // If a prior dialog is still present (e.g. due to retries/navigation timing),
  // close it so we don't hit strict-mode violations.
  const existingDialogs = page.locator('.cdk-overlay-container .blocked-users-dialog');
  const existingCount = await existingDialogs.count().catch(() => 0);
  if (existingCount > 0) {
    await page.keyboard.press('Escape').catch(() => {});
    // Best-effort: wait for overlays to settle.
    await existingDialogs.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  const blockedSection = page.locator('.settings-section').filter({
    has: page.locator('.section-header mat-icon', { hasText: /^block$/ }),
  });
  await blockedSection.first().waitFor({ state: 'visible', timeout: 15000 });

  const manageItem = blockedSection.locator('.setting-item.clickable').first();
  await manageItem.scrollIntoViewIfNeeded().catch(() => {});
  await manageItem.click();

  // Target the top-most dialog to avoid strict-mode violations when multiple dialogs exist in the DOM.
  const dialog = page.locator('.cdk-overlay-container mat-dialog-container').filter({
    has: page.locator('.blocked-users-dialog'),
  }).last().locator('.blocked-users-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
}

export async function unblockUserFromManageBlocked(page: Page, displayName: string): Promise<void> {
  const dialog = page
    .locator('.cdk-overlay-container mat-dialog-container')
    .filter({ has: page.locator('.blocked-users-dialog') })
    .last()
    .locator('.blocked-users-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  // Wait for the dialog to finish loading its list (or show empty state).
  const loadingState = dialog.locator('.loading-state');
  if (await loadingState.isVisible().catch(() => false)) {
    await loadingState.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }

  const row = dialog.locator('.blocked-user-item').filter({
    has: page.locator('.user-name', { hasText: displayName }),
  });

  // If not present, treat as already unblocked.
  const present = (await row.count()) > 0;
  if (!present) return;

  await row.first().locator('.unblock-btn').click();
  await expect(row).toHaveCount(0, { timeout: 30000 });
}

export async function unblockFirstUserFromManageBlocked(page: Page): Promise<boolean> {
  const dialog = page
    .locator('.cdk-overlay-container mat-dialog-container')
    .filter({ has: page.locator('.blocked-users-dialog') })
    .last()
    .locator('.blocked-users-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  const loadingState = dialog.locator('.loading-state');
  if (await loadingState.isVisible().catch(() => false)) {
    await loadingState.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }

  const items = dialog.locator('.blocked-user-item');
  const count = await items.count();
  if (count === 0) return false;

  await items.first().locator('.unblock-btn').click();
  await expect(items).toHaveCount(count - 1, { timeout: 30000 }).catch(async () => {
    // If count isn't stable (e.g., list refresh), accept empty state as success.
    await expect(dialog.locator('.empty-state')).toBeVisible({ timeout: 30000 });
  });
  return true;
}

export async function blockUserFromUserProfile(page: Page, displayName: string): Promise<void> {
  // On /user/:id page, open the "more" menu and click Block User.
  const profilePage = page.locator('.user-profile-page');
  await profilePage.waitFor({ state: 'visible', timeout: 20000 });

  // Snackbars/toasts can animate and keep elements from becoming "stable", which can hang
  // scrollIntoView/click retry loops. Best-effort: dismiss/wait them out before clicking.
  const snackbar = page.locator(
    [
      '.cdk-overlay-container mat-snack-bar-container',
      '.cdk-overlay-container .mat-mdc-snack-bar-container',
      '.cdk-overlay-container .mat-snack-bar-container',
    ].join(', ')
  );
  if (await snackbar.first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await snackbar.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  // Use multiple selector strategies for the "More options" menu button
  // Angular renders [matMenuTriggerFor] as the attribute 'matmenutriggerfor' (lowercase)
  // The matTooltip uses translation key, so we also look for the icon
  const menuTrigger = profilePage.locator([
    'button[matmenutriggerfor]',
    'button:has(mat-icon:text("more_vert"))',
    'button.icon-btn:has(mat-icon)',
  ].join(', ')).last();
  
  await menuTrigger.waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
    // Debug: log what buttons are visible
    const buttons = profilePage.locator('button');
    const count = await buttons.count();
    debugLog(`[Debug] Found ${count} buttons on profile page`);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const classes = await buttons.nth(i).getAttribute('class');
      const icon = await buttons.nth(i).locator('mat-icon').textContent().catch(() => 'no-icon');
      debugLog(`[Debug] Button ${i}: class="${classes}", icon="${icon}"`);
    }
    throw new Error('Menu trigger button not found on profile page');
  });

  // Avoid scrollIntoViewIfNeeded here; go straight to click with a force fallback.
  await menuTrigger.click({ timeout: 15000 }).catch(async () => {
    await menuTrigger.click({ timeout: 15000, force: true });
  });

  const blockMenuItem = page.getByRole('menuitem', { name: /block user/i });
  await blockMenuItem.click();

  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  await expect(dialog).toContainText(`Block ${displayName}`);
  await dialog.getByRole('button', { name: /block user/i }).click();

  // After blocking, app navigates away to /discover
  await page.waitForURL(/\/discover/, { timeout: 30000 });
}

export async function blockUserFromMessagesConversation(page: Page, otherDisplayName: string): Promise<void> {
  await page.goto('/messages');
  await page.locator('app-messages, .messages-page').first().waitFor({ state: 'visible', timeout: 30000 });

  const convoBtn = page
    .locator('button.conversation-item')
    .filter({ has: page.locator('.conversation-name', { hasText: otherDisplayName }) })
    .first();
  await expect(convoBtn).toBeVisible({ timeout: 30000 });
  await convoBtn.click();

  const chatHeader = page.locator('app-chat-header, .chat-header').first();
  await expect(chatHeader).toBeVisible({ timeout: 20000 });

  const optionsBtn = chatHeader.locator('button.options-btn').first();
  await optionsBtn.click().catch(async () => {
    await optionsBtn.click({ force: true });
  });

  await page.getByRole('menuitem', { name: /block user/i }).click();

  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await expect(dialog).toContainText(new RegExp(`Block\\s+${otherDisplayName}`, 'i'));
  await dialog.getByRole('button', { name: /block user/i }).click();

  // After blocking, messages page should navigate back to list (/messages).
  await page.waitForURL(/\/messages\/?$/, { timeout: 30000 }).catch(() => {});
}

export async function expectNotVisibleInDiscover(page: Page, displayName: string): Promise<void> {
  await page.goto('/discover');
  await page.locator('app-discover').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.refresh-btn').click().catch(() => {});

  const card = page.locator('app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName }),
  });

  await expect(card).toHaveCount(0, { timeout: 30000 });
}

export async function expectNotVisibleInAllMatchesTabs(page: Page, displayName: string): Promise<void> {
  await page.goto('/matches');
  await page.locator('.matches-page').waitFor({ state: 'visible', timeout: 30000 });

  const tabs = ['My Matches', 'My Favorites', 'Recently Viewed', 'Favorited Me', 'Viewed Me'];
  const cardInMatches = page.locator('.matches-content app-profile-card').filter({
    has: page.locator('.card-name', { hasText: displayName }),
  });

  const upgradeDialog = page.locator('.upgrade-dialog');
  const dismissUpgradeDialogIfPresent = async () => {
    const visible = await upgradeDialog.isVisible().catch(() => false);
    if (!visible) return;
    // Prefer "Maybe Later" if available, otherwise close button.
    await upgradeDialog.locator('button.secondary-btn', { hasText: /maybe later/i }).click().catch(async () => {
      await upgradeDialog.locator('button.close-btn').click().catch(() => {});
    });
    await upgradeDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  };

  for (const tabName of tabs) {
    const tab = page.locator('.tab-btn', { hasText: tabName });
    const visible = await tab.isVisible().catch(() => false);
    if (!visible) continue;

    // Avoid clicking locked premium tabs (they open an upgrade dialog for non-premium users).
    const isLocked = await tab.evaluate((el) => el.classList.contains('premium-locked')).catch(() => false);
    if (isLocked) {
      await dismissUpgradeDialogIfPresent();
      continue;
    }

    await tab.click();
    await page.waitForTimeout(500);
    await dismissUpgradeDialogIfPresent();
    await expect(cardInMatches).toHaveCount(0, { timeout: 15000 });
  }
}

export async function expectConversationBlockedInMessages(page: Page, otherDisplayName: string): Promise<void> {
  await page.goto('/messages');
  await page.locator('app-messages, .messages-page').first().waitFor({ state: 'visible', timeout: 30000 });

  const convoBtn = page
    .locator('button.conversation-item')
    .filter({ has: page.locator('.conversation-name', { hasText: otherDisplayName }) })
    .first();
  await expect(convoBtn).toBeVisible({ timeout: 30000 });
  await convoBtn.click();

  // Blocked users cannot see presence indicators.
  const chatHeader = page.locator('app-chat-header, .chat-header').first();
  await expect(chatHeader).toBeVisible({ timeout: 15000 });
  await expect(chatHeader.locator('.online-dot')).toHaveCount(0);
  await expect(chatHeader.locator('.chat-user-status')).toHaveCount(0);

  // And cannot message.
  const restriction = page.locator('.message-restriction-alert');
  await expect(restriction).toBeVisible({ timeout: 15000 });
  await expect(restriction).toContainText(/cannot message/i);
}

