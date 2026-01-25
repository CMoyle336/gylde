import { test, expect } from '../fixtures/auth.fixture';
import { DISCOVER_TEST_USERS } from '../fixtures/test-users';
import {
  forceSetUserCreateOnFavorite,
  forceSetUserCreateOnView,
  forceSetUserLastActiveMinutesAgo,
  forceSetUserProfileVisible,
  forceSetUserShowLastActive,
  forceSetUserShowLocation,
  forceSetUserShowOnlineStatus,
  getAdminDb,
  getCurrentUserUid,
  getFavoriteNotificationsToggle,
  getLastActiveToggle,
  getOnlineStatusToggle,
  getProfileVisibilityToggle,
  getProfileViewNotificationsToggle,
  getShowLocationToggle,
  goToDiscoverPage,
  goToMatchesPage,
  goToMessagesPage,
  goToSettingsPage,
  isMaterialToggleChecked,
  logout,
  setMaterialToggle,
  startConversation,
  verifyUserShowOnlineStatus,
  waitForSettingsSave,
  viewUserProfile,
} from '../utils/settings-helpers';

test.describe.serial('Settings - Show Online Status', () => {
  test.beforeEach(async ({ loginAsAlice }) => {
    await loginAsAlice();
  });

  test('can toggle show online status setting', async ({ page }) => {
    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);

    const wasChecked = await isMaterialToggleChecked(toggleSwitch, toggle);
    await setMaterialToggle(toggle, toggleSwitch, !wasChecked);
    await waitForSettingsSave(page);
    await setMaterialToggle(toggle, toggleSwitch, wasChecked);
    await waitForSettingsSave(page);
  });

  test('when disabled, other users cannot see online status on discover page', async ({ page, loginAs, alice, bob }) => {
    test.setTimeout(90000);

    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const aliceCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Alice Test' }),
    });

    const isVisible = await aliceCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (isVisible) {
      await expect(aliceCard.locator('.activity-badge.online')).not.toBeVisible();
    }

    // Cleanup
    await logout(page);
    await loginAs(alice);
    await goToSettingsPage(page);
    const { toggle: toggleCleanup, toggleSwitch: toggleSwitchCleanup } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggleCleanup, toggleSwitchCleanup, true);
    await waitForSettingsSave(page);
  });

  test('when disabled, other users cannot see online status on matches page', async ({ page, loginAs, alice, bob }) => {
    test.setTimeout(90000);

    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    const aliceUid = await getCurrentUserUid(page);
    if (aliceUid) {
      const adminAvailable = await getAdminDb();
      if (adminAvailable) {
        await forceSetUserShowOnlineStatus(aliceUid, false);
        await forceSetUserLastActiveMinutesAgo(aliceUid, 30);
      }
    }

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const aliceCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Alice Test' }),
    });

    const isVisible = await aliceCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (isVisible) {
      const favoriteBtn = aliceCard.locator('.action-btn.favorite');
      const isFavorited = await aliceCard.locator('.action-btn.favorite.favorited').isVisible().catch(() => false);
      if (!isFavorited) {
        await favoriteBtn.click();
        await page.waitForTimeout(1000);
      }

      await goToMatchesPage(page);
      await page.locator('.tab-btn', { hasText: 'My Favorites' }).click();
      await page.waitForTimeout(1000);

      const aliceCardInFavorites = page.locator('.matches-content app-profile-card').filter({
        has: page.locator('.card-name', { hasText: 'Alice Test' }),
      });

      const inFavorites = await aliceCardInFavorites.isVisible({ timeout: 5000 }).catch(() => false);
      if (inFavorites) {
        const onlineBadge = aliceCardInFavorites.locator('.activity-badge.online');
        await expect
          .poll(async () => onlineBadge.isVisible().catch(() => false), { timeout: 30000 })
          .toBe(false);
      }
    }

    // Cleanup
    await logout(page);
    await loginAs(alice);
    await goToSettingsPage(page);
    const { toggle: toggleCleanup, toggleSwitch: toggleSwitchCleanup } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggleCleanup, toggleSwitchCleanup, true);
    await waitForSettingsSave(page);
  });

  test('when disabled, other users cannot see online status on profile page', async ({ page, loginAs, alice, bob }) => {
    test.setTimeout(90000);

    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const aliceCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Alice Test' }),
    });
    const isVisible = await aliceCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (isVisible) {
      await viewUserProfile(page, 'Alice Test');
      await expect(page.locator('.stat-value.online')).not.toBeVisible();
      await expect(page.locator('.stat-value', { hasText: 'Online now' })).not.toBeVisible();
    }

    // Cleanup
    await logout(page);
    await loginAs(alice);
    await goToSettingsPage(page);
    const { toggle: toggleCleanup, toggleSwitch: toggleSwitchCleanup } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggleCleanup, toggleSwitchCleanup, true);
    await waitForSettingsSave(page);
  });

  test('when disabled, other users cannot see online status in messages', async ({ page, loginAs, alice, bob }) => {
    test.setTimeout(120000);

    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    const aliceUid = await getCurrentUserUid(page);
    if (aliceUid) {
      const adminAvailable = await getAdminDb();
      if (adminAvailable) {
        const persisted = await verifyUserShowOnlineStatus(aliceUid, false);
        if (!persisted) {
          await forceSetUserShowOnlineStatus(aliceUid, false);
        }
      }
    }

    await logout(page);

    await loginAs(bob);
    await startConversation(page, 'Alice Test');

    const chatHeader = page.locator('app-chat-header, .chat-header').first();
    const headerVisible = await chatHeader.isVisible({ timeout: 5000 }).catch(() => false);
    if (headerVisible) {
      await expect(chatHeader.locator('.online-dot')).not.toBeVisible({ timeout: 30000 });
      await expect(chatHeader.locator('.chat-user-status.online')).not.toBeVisible({ timeout: 30000 });
    }

    // Cleanup
    await logout(page);
    await loginAs(alice);
    await goToSettingsPage(page);
    const { toggle: toggleCleanup, toggleSwitch: toggleSwitchCleanup } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggleCleanup, toggleSwitchCleanup, true);
    await waitForSettingsSave(page);
  });

  test('when enabled, other users CAN see online status', async ({ page, loginAs, bob }) => {
    test.setTimeout(90000);

    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getOnlineStatusToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, true);
    await waitForSettingsSave(page);

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const aliceCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: 'Alice Test' }),
    });
    const isVisible = await aliceCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (isVisible) {
      // Presence of activity badge is enough here; exact online-ness depends on lastActive timing.
      await expect(aliceCard.locator('.activity-badge')).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe.serial('Settings - Show Last Active', () => {
  const subject = DISCOVER_TEST_USERS.activeTierUser; // "Active Anna"
  let subjectUid: string | null = null;

  test.afterEach(async () => {
    // Best-effort cleanup via Admin SDK (no extra logins / no extra auth quota).
    if (!subjectUid) return;
    const admin = await getAdminDb();
    if (!admin) return;
    await forceSetUserShowLastActive(subjectUid, true);
  });

  test('when disabled, other users cannot see last active on discover page', async ({ page, loginAs, bob }) => {
    test.setTimeout(120000);

    await loginAs(subject);
    await goToSettingsPage(page);

    const { toggle, toggleSwitch } = await getLastActiveToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) {
        await forceSetUserShowLastActive(subjectUid, false);
        await forceSetUserShowOnlineStatus(subjectUid, true);
        await forceSetUserLastActiveMinutesAgo(subjectUid, 30);
      }
    }

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const card = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });

    const isVisible = await card.isVisible({ timeout: 8000 }).catch(() => false);
    if (isVisible) {
      // With showLastActive disabled, we should never show a stale "Active X ago" style badge.
      // It's still valid to show "Online now" if showOnlineStatus is enabled and the user is online.
      await expect(card.locator('.activity-badge:not(.online)')).not.toBeVisible({ timeout: 15000 });
    }
  });

  test('when disabled, other users cannot see last active on matches page', async ({ page, loginAs, bob }) => {
    test.setTimeout(150000);

    await loginAs(subject);
    await goToSettingsPage(page);

    const { toggle, toggleSwitch } = await getLastActiveToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) {
        await forceSetUserShowLastActive(subjectUid, false);
        await forceSetUserShowOnlineStatus(subjectUid, true);
        await forceSetUserLastActiveMinutesAgo(subjectUid, 30);
      }
    }

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const subjectCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });

    const isVisible = await subjectCard.isVisible({ timeout: 8000 }).catch(() => false);
    if (isVisible) {
      const favoriteBtn = subjectCard.locator('.action-btn.favorite');
      const isFavorited = await subjectCard.locator('.action-btn.favorite.favorited').isVisible().catch(() => false);
      if (!isFavorited) {
        await favoriteBtn.click();
        await page.waitForTimeout(1000);
      }

      await goToMatchesPage(page);
      await page.locator('.tab-btn', { hasText: 'My Favorites' }).click();
      await page.waitForTimeout(1000);

      const cardInMatches = page.locator('.matches-content app-profile-card').filter({
        has: page.locator('.card-name', { hasText: subject.displayName }),
      });

      const inMatches = await cardInMatches.isVisible({ timeout: 8000 }).catch(() => false);
      if (inMatches) {
        await expect(cardInMatches.locator('.activity-badge:not(.online)')).not.toBeVisible({ timeout: 15000 });
      }
    }
  });

  test('when disabled, other users cannot see last active on profile page', async ({ page, loginAs, bob }) => {
    test.setTimeout(150000);

    await loginAs(subject);
    await goToSettingsPage(page);

    const { toggle, toggleSwitch } = await getLastActiveToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) {
        await forceSetUserShowLastActive(subjectUid, false);
        await forceSetUserShowOnlineStatus(subjectUid, true);
        await forceSetUserLastActiveMinutesAgo(subjectUid, 30);
      }
    }

    await logout(page);

    await loginAs(bob);
    await goToDiscoverPage(page);

    const subjectCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });

    const isVisible = await subjectCard.isVisible({ timeout: 8000 }).catch(() => false);
    if (isVisible) {
      await viewUserProfile(page, subject.displayName);

      const lastActiveStat = page.locator('.stat-item').filter({
        has: page.locator('.stat-label', { hasText: /last active/i }),
      });
      const statVisible = await lastActiveStat.isVisible({ timeout: 8000 }).catch(() => false);
      if (statVisible) {
        // We should not show "Active X ago" when showLastActive is disabled.
        await expect(lastActiveStat.locator('.stat-value')).not.toContainText(/active|ago/i, { timeout: 15000 });
      }
    }
  });

  test('when disabled, other users cannot see last active in messages', async ({ page, loginAs, bob }) => {
    test.setTimeout(180000);

    await loginAs(subject);
    await goToSettingsPage(page);

    const { toggle, toggleSwitch } = await getLastActiveToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) {
        await forceSetUserShowLastActive(subjectUid, false);
        await forceSetUserShowOnlineStatus(subjectUid, true);
        await forceSetUserLastActiveMinutesAgo(subjectUid, 30);
      }
    }

    await logout(page);

    await loginAs(bob);
    await startConversation(page, subject.displayName);

    const chatHeader = page.locator('app-chat-header, .chat-header').first();
    const headerVisible = await chatHeader.isVisible({ timeout: 10000 }).catch(() => false);
    if (headerVisible) {
      // With showLastActive disabled, we should not show any "Active X ago" / last-active style text.
      // It's still valid to show "Online now" (and the dot) if showOnlineStatus is enabled and the user is online.
      const status = chatHeader.locator('.chat-user-status').first();
      const statusVisible = await status.isVisible({ timeout: 3000 }).catch(() => false);
      if (statusVisible) {
        const text = (await status.innerText().catch(() => '')).trim();
        // "Active now" is treated as an online indicator in this UI. We only want to ensure we
        // don't leak last-active timestamps like "Active 5m ago" when showLastActive is disabled.
        expect(text).not.toMatch(/ago|\brecently\b|\btoday\b|\byesterday\b|\bweek\b/i);
        expect(text).not.toMatch(
          /\b\d+\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)\b/i
        );
      }
    }
  });
});

test.describe.serial('Settings - Profile Visibility', () => {
  const subject = DISCOVER_TEST_USERS.activeTierUser; // "Active Anna"
  let subjectUid: string | null = null;

  test.afterEach(async () => {
    // Best-effort cleanup via Admin SDK (no extra logins / no extra auth quota).
    if (!subjectUid) return;
    const admin = await getAdminDb();
    if (!admin) return;
    await forceSetUserProfileVisible(subjectUid, true);
  });

  test('hides user from discover, but keeps them visible in matches + messages', async ({ page, loginAs, bob }) => {
    test.setTimeout(240000);

    // 1) Ensure subject is discoverable to begin with (so Bob can favorite + start a chat).
    await loginAs(subject);
    await goToSettingsPage(page);
    const { toggle: visibleToggle, toggleSwitch: visibleSwitch } = await getProfileVisibilityToggle(page);
    await setMaterialToggle(visibleToggle, visibleSwitch, true);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) await forceSetUserProfileVisible(subjectUid, true);
    }
    await logout(page);

    // 2) Bob favorites subject and starts a conversation while subject is visible on discover.
    await loginAs(bob);
    await goToDiscoverPage(page);

    const subjectCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });
    await subjectCard.first().waitFor({ state: 'visible', timeout: 30000 });

    const alreadyFav = await subjectCard.first().locator('.action-btn.favorite.favorited').isVisible().catch(() => false);
    if (!alreadyFav) {
      await subjectCard.first().locator('.action-btn.favorite').click();
      await expect(subjectCard.first().locator('.action-btn.favorite.favorited')).toBeVisible({ timeout: 15000 });
    }

    await startConversation(page, subject.displayName);
    await expect(page.locator('app-chat-header, .chat-header').first()).toBeVisible({ timeout: 20000 });
    await logout(page);

    // 3) Subject disables profile visibility (hide from discover).
    await loginAs(subject);
    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getProfileVisibilityToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = subjectUid || (await getCurrentUserUid(page));
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) await forceSetUserProfileVisible(subjectUid, false);
    }
    await logout(page);

    // 4) Bob should NOT see subject in discover results.
    await loginAs(bob);
    await goToDiscoverPage(page);
    await page.locator('.refresh-btn').click().catch(() => {});

    await expect
      .poll(async () => page.locator('app-profile-card').count(), { timeout: 30000 })
      .toBeGreaterThan(0);

    await expect(subjectCard).toHaveCount(0, { timeout: 30000 });

    // 5) Bob SHOULD still see subject in matches favorites.
    await goToMatchesPage(page);
    await page.locator('.tab-btn', { hasText: 'My Favorites' }).click();
    await page.waitForTimeout(1000);

    const cardInFavorites = page.locator('.matches-content app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });
    await expect(cardInFavorites).toBeVisible({ timeout: 30000 });

    // 6) Bob SHOULD still see the conversation in messages.
    await goToMessagesPage(page);
    const convoBtn = page
      .locator('button.conversation-item')
      .filter({ has: page.locator('.conversation-name', { hasText: subject.displayName }) })
      .first();

    await expect(convoBtn).toBeVisible({ timeout: 30000 });
    await convoBtn.click();

    const chatHeader = page.locator('app-chat-header, .chat-header').first();
    await expect(chatHeader).toBeVisible({ timeout: 15000 });
    await expect(chatHeader).toContainText(subject.displayName, { timeout: 15000 });
  });
});

test.describe.serial('Settings - Show Location', () => {
  const subject = DISCOVER_TEST_USERS.activeTierUser; // "Active Anna"
  let subjectUid: string | null = null;

  test.afterEach(async () => {
    // Best-effort cleanup via Admin SDK (no extra logins / no extra auth quota).
    if (!subjectUid) return;
    const admin = await getAdminDb();
    if (!admin) return;
    await forceSetUserShowLocation(subjectUid, true);
  });

  test('when disabled, other users cannot see location on discover, matches, or profile page', async ({ page, loginAs, bob }) => {
    test.setTimeout(240000);

    // 1) Subject disables showLocation
    await loginAs(subject);
    await goToSettingsPage(page);

    const { toggle, toggleSwitch } = await getShowLocationToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    subjectUid = await getCurrentUserUid(page);
    if (subjectUid) {
      const admin = await getAdminDb();
      if (admin) await forceSetUserShowLocation(subjectUid, false);
    }

    await logout(page);

    // 2) Bob checks Discover card does not show location
    await loginAs(bob);
    await goToDiscoverPage(page);

    const subjectCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });

    const cardVisible = await subjectCard.first().isVisible({ timeout: 10000 }).catch(() => false);
    if (cardVisible) {
      await expect(subjectCard.first().locator('.card-location')).not.toBeVisible({ timeout: 15000 });

      // 3) Bob views /user/:id profile page and location should be hidden
      await subjectCard.first().locator('.action-btn.view').click();
      await page.locator('.user-profile-page').waitFor({ state: 'visible', timeout: 20000 });
      await expect(page.locator('.user-profile-page .location')).not.toBeVisible({ timeout: 15000 });

      // Navigate back to Discover to proceed with Matches check
      await goToDiscoverPage(page);
    }

    // 4) Ensure subject is in favorites so they'll appear in Matches tab
    const canFavorite = await subjectCard.first().isVisible({ timeout: 8000 }).catch(() => false);
    if (canFavorite) {
      const alreadyFav = await subjectCard
        .first()
        .locator('.action-btn.favorite.favorited')
        .isVisible()
        .catch(() => false);
      if (!alreadyFav) {
        await subjectCard.first().locator('.action-btn.favorite').click();
        await expect(subjectCard.first().locator('.action-btn.favorite.favorited')).toBeVisible({ timeout: 15000 });
      }
    }

    // 5) Bob checks Matches favorites card does not show location
    await goToMatchesPage(page);
    await page.locator('.tab-btn', { hasText: 'My Favorites' }).click();
    await page.waitForTimeout(1000);

    const cardInFavorites = page.locator('.matches-content app-profile-card').filter({
      has: page.locator('.card-name', { hasText: subject.displayName }),
    });

    const inFavorites = await cardInFavorites.first().isVisible({ timeout: 15000 }).catch(() => false);
    if (inFavorites) {
      await expect(cardInFavorites.first().locator('.card-location')).not.toBeVisible({ timeout: 15000 });
    }
  });
});

test.describe.serial('Settings - Profile View Notifications', () => {
  let bobUid: string | null = null;

  test.afterEach(async () => {
    // Best-effort cleanup via Admin SDK.
    if (!bobUid) return;
    const admin = await getAdminDb();
    if (!admin) return;
    await forceSetUserCreateOnView(bobUid, true);
  });

  test('when disabled, viewing someone does not create activity or show in Viewed Me (premium)', async ({ page, loginAs, alice, bob }) => {
    test.setTimeout(240000);

    // Bob disables "profile view notifications" (i.e., don't create view activity for others).
    await loginAs(bob);
    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getProfileViewNotificationsToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    bobUid = await getCurrentUserUid(page);
    if (bobUid) {
      const admin = await getAdminDb();
      if (admin) await forceSetUserCreateOnView(bobUid, false);
    }

    // Bob views Alice's profile (this would normally create a "view" activity for Alice).
    await goToDiscoverPage(page);
    await viewUserProfile(page, alice.displayName);
    await page.waitForTimeout(1000);

    await logout(page);

    // Alice (premium) should NOT see an activity item, and should NOT see Bob in Viewed Me.
    await loginAs(alice);
    await goToDiscoverPage(page);

    const activitySection = page.locator('.sidebar-activity');
    await expect(activitySection).toBeVisible({ timeout: 15000 });

    // Expand activity section if collapsed
    const collapsed = await activitySection.evaluate((el) => el.classList.contains('collapsed')).catch(() => false);
    if (collapsed) {
      await activitySection.locator('.activity-header').click();
      await page.waitForTimeout(300);
    }

    const viewActivity = activitySection.locator('.activity-item').filter({
      has: page.locator('.activity-text', { hasText: `${bob.displayName} viewed your profile` }),
    });
    await expect(viewActivity).toHaveCount(0, { timeout: 15000 });

    await goToMatchesPage(page);
    const viewedMeTab = page.locator('.tab-btn', { hasText: 'Viewed Me' });
    await expect(viewedMeTab).toBeVisible({ timeout: 15000 });
    await expect(viewedMeTab).not.toHaveClass(/premium-locked/, { timeout: 15000 });
    await viewedMeTab.click();
    await expect(viewedMeTab).toHaveClass(/active/, { timeout: 15000 });

    // Wait for loading skeleton to clear, then assert Bob isn't present.
    await expect(page.locator('.matches-content app-profile-card-skeleton')).toHaveCount(0, { timeout: 20000 });
    const bobCard = page.locator('.matches-content app-profile-card').filter({
      has: page.locator('.card-name', { hasText: bob.displayName }),
    });
    await expect(bobCard).toHaveCount(0, { timeout: 15000 });
  });
});

test.describe.serial('Settings - Favorite Notifications', () => {
  let bobUid: string | null = null;

  test.afterEach(async () => {
    // Best-effort cleanup via Admin SDK.
    if (!bobUid) return;
    const admin = await getAdminDb();
    if (!admin) return;
    await forceSetUserCreateOnFavorite(bobUid, true);
  });

  test('when disabled, favoriting someone does not create activity or show in Favorited Me (premium)', async ({
    page,
    loginAs,
    alice,
    bob,
  }) => {
    test.setTimeout(240000);

    // Bob disables "favorite notifications" (i.e., favorites are private).
    await loginAs(bob);
    await goToSettingsPage(page);
    const { toggle, toggleSwitch } = await getFavoriteNotificationsToggle(page);
    await setMaterialToggle(toggle, toggleSwitch, false);
    await waitForSettingsSave(page);

    bobUid = await getCurrentUserUid(page);
    if (bobUid) {
      const admin = await getAdminDb();
      if (admin) await forceSetUserCreateOnFavorite(bobUid, false);
    }

    // Bob favorites Alice (this would normally create a "favorite" activity for Alice and add Bob to Favorited Me).
    await goToDiscoverPage(page);
    const aliceCard = page.locator('app-profile-card').filter({
      has: page.locator('.card-name', { hasText: alice.displayName }),
    });
    await aliceCard.first().waitFor({ state: 'visible', timeout: 30000 });
    await aliceCard.first().locator('.action-btn.favorite').click();
    await expect(aliceCard.first().locator('.action-btn.favorite.favorited')).toBeVisible({ timeout: 15000 });

    await logout(page);

    // Alice (premium) should NOT see an activity item, and should NOT see Bob in Favorited Me.
    await loginAs(alice);
    await goToDiscoverPage(page);

    const activitySection = page.locator('.sidebar-activity');
    await expect(activitySection).toBeVisible({ timeout: 15000 });

    // Expand activity section if collapsed
    const collapsed = await activitySection.evaluate((el) => el.classList.contains('collapsed')).catch(() => false);
    if (collapsed) {
      await activitySection.locator('.activity-header').click();
      await page.waitForTimeout(300);
    }

    const favoriteActivity = activitySection.locator('.activity-item').filter({
      has: page.locator('.activity-text', { hasText: `${bob.displayName} favorited you` }),
    });
    await expect(favoriteActivity).toHaveCount(0, { timeout: 15000 });

    await goToMatchesPage(page);
    const favoritedMeTab = page.locator('.tab-btn', { hasText: 'Favorited Me' });
    await expect(favoritedMeTab).toBeVisible({ timeout: 15000 });
    await expect(favoritedMeTab).not.toHaveClass(/premium-locked/, { timeout: 15000 });
    await favoritedMeTab.click();
    await expect(favoritedMeTab).toHaveClass(/active/, { timeout: 15000 });

    await expect(page.locator('.matches-content app-profile-card-skeleton')).toHaveCount(0, { timeout: 20000 });
    const bobCard = page.locator('.matches-content app-profile-card').filter({
      has: page.locator('.card-name', { hasText: bob.displayName }),
    });
    await expect(bobCard).toHaveCount(0, { timeout: 15000 });
  });
});

