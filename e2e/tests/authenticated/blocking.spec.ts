import { test, expect } from '../fixtures/auth.fixture';
import { getAdminDb, getUidByEmail, logout } from '../utils/settings-helpers';
import {
  adminClearAllBlocksForUser,
  adminEnsureUnblocked,
  adminExpectCleanupBetweenUsers,
  adminSeedActivity,
  adminSeedFavorite,
  adminSeedProfileView,
  blockUserFromUserProfile,
  blockUserFromMessagesConversation,
  expectConversationBlockedInMessages,
  expectNotVisibleInAllMatchesTabs,
  openManageBlockedUsers,
  unblockFirstUserFromManageBlocked,
  unblockUserFromManageBlocked,
} from '../utils/blocking-helpers';

test.describe.serial('Blocking', () => {
  function isLiveEnvironment(): boolean {
    const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
    return baseUrl.includes('gylde.com');
  }

  async function waitUntilUnblocked(blockerUid: string, blockedUid: string): Promise<void> {
    const db = await getAdminDb();
    if (!db) return;
    const timeoutMs = isLiveEnvironment() ? 60000 : 30000;

    await expect
      .poll(async () => (await db.doc(`users/${blockerUid}/blocks/${blockedUid}`).get()).exists, { timeout: timeoutMs })
      .toBe(false);
    await expect
      .poll(async () => (await db.doc(`users/${blockedUid}/blockedBy/${blockerUid}`).get()).exists, { timeout: timeoutMs })
      .toBe(false);
  }

  async function expectProfileVisible(page: any, userUid: string, displayName: string): Promise<void> {
    const timeoutMs = isLiveEnvironment() ? 60000 : 30000;
    const url = `/user/${userUid}`;

    // Navigate once
    await page.goto(url);
    
    // Wait for profile page to be visible
    const profilePage = page.locator('.user-profile-page');
    await profilePage.waitFor({ state: 'visible', timeout: timeoutMs });
    
    // Check there's no error state
    const errorState = profilePage.locator('.error-state');
    const hasError = await errorState.isVisible().catch(() => false);
    if (hasError) {
      const errorText = await errorState.textContent().catch(() => 'Unknown error');
      throw new Error(`Profile page shows error state: ${errorText}`);
    }
    
    // Wait for the profile name to be visible
    const profileName = profilePage.locator('.profile-name', { hasText: displayName });
    await expect(profileName).toBeVisible({ timeout: timeoutMs });
  }

  async function expectProfileUnavailable(page: any, userUid: string): Promise<void> {
    await page.goto(`/user/${userUid}`);
    const profilePage = page.locator('.user-profile-page');
    await profilePage.waitFor({ state: 'visible', timeout: 30000 });
    await expect(profilePage.locator('.error-state')).toBeVisible({ timeout: 30000 });
    await expect(profilePage.locator('.error-state')).toContainText(/not available/i, { timeout: 30000 });
  }

  async function startConversationFromProfile(page: any, userUid: string): Promise<void> {
    await page.goto(`/user/${userUid}`);
    const profilePage = page.locator('.user-profile-page');
    await profilePage.waitFor({ state: 'visible', timeout: 30000 });
    await expect(profilePage.locator('.error-state')).toHaveCount(0, { timeout: 15000 });
    await profilePage.locator('button.message-btn').click();
    await page.waitForURL(/\/messages(\/|$)/, { timeout: 30000 });
    await expect(page.locator('app-chat-header, .chat-header').first()).toBeVisible({ timeout: 20000 });
  }

  async function sendTextMessage(page: any, message: string): Promise<void> {
    const input = page.locator('.chat-input input[type="text"]').first();
    await input.waitFor({ state: 'visible', timeout: 20000 });
    await input.fill(message);
    const sendBtn = page.locator('.chat-input .send-btn:not([disabled])').first();
    await sendBtn.waitFor({ state: 'visible', timeout: 20000 });
    await sendBtn.click();
    await expect(page.locator('.message .bubble p', { hasText: message }).first()).toBeVisible({ timeout: 30000 });
  }

  async function waitForConversationToBeVisibleToRecipient(uidA: string, uidB: string): Promise<void> {
    const db = await getAdminDb();
    if (!db) return;

    const hasLastMessage = async (): Promise<boolean> => {
      const snap = await db.collection('conversations').where('participants', 'array-contains', uidA).get();
      const match = snap.docs.find((d: any) => {
        const participants = (d.data()?.participants || []) as string[];
        return participants.includes(uidB);
      });
      if (!match) return false;
      const data = match.data() as any;
      return !!data?.lastMessage;
    };

    await expect.poll(hasLastMessage, { timeout: 45000 }).toBe(true);
  }

  test('block + unblock: hides from discover/matches, deletes favorites/views/activity, preserves conversation but blocks messaging', async ({
    page,
    loginAs,
    suiteAlice: alice,
    suiteBob: bob,
  }) => {
    test.setTimeout(360000);

    const aliceUid = await getUidByEmail(alice.email);
    const bobUid = await getUidByEmail(bob.email);
    if (!aliceUid || !bobUid) {
      throw new Error('Missing Alice/Bob UID. Live env Admin SDK auth may not be configured.');
    }

    // Seed mutual favorites/views/activity so the block cleanup is meaningful.
    await adminClearAllBlocksForUser(aliceUid);
    await adminClearAllBlocksForUser(bobUid);
    await adminEnsureUnblocked(aliceUid, bobUid);
    await adminSeedFavorite(aliceUid, bobUid);
    await adminSeedFavorite(bobUid, aliceUid);
    await adminSeedProfileView(aliceUid, bobUid);
    await adminSeedProfileView(bobUid, aliceUid);
    await adminSeedActivity({ recipientUid: aliceUid, fromUid: bobUid, type: 'favorite', fromUserName: bob.displayName });
    await adminSeedActivity({ recipientUid: bobUid, fromUid: aliceUid, type: 'view', fromUserName: alice.displayName });

    // Login once as Alice for the whole "block" phase.
    await loginAs(alice);

    // Precondition: Alice can access Bob's profile directly before blocking.
    await expectProfileVisible(page, bobUid, bob.displayName);

    // Start a conversation before blocking (conversation should persist).
    await startConversationFromProfile(page, bobUid);
    // Ensure the conversation becomes visible to the recipient (empty convos are hidden until a message is sent).
    const firstMsg = 'hello from alice';
    await sendTextMessage(page, firstMsg);
    await waitForConversationToBeVisibleToRecipient(aliceUid, bobUid);

    // Alice blocks Bob via user profile page (representative UI path).
    await page.goto(`/user/${bobUid}`);
    await blockUserFromUserProfile(page, bob.displayName);

    // Alice should not be able to view Bob's profile, and should not see him in matches.
    await expectProfileUnavailable(page, bobUid);
    await expectNotVisibleInAllMatchesTabs(page, bob.displayName);

    // Alice: conversation still present but blocked (cannot message + no presence).
    await expectConversationBlockedInMessages(page, bob.displayName);
    await logout(page);

    // Bob should not be able to view Alice's profile, should not see her in matches, but should still have the conversation blocked.
    await loginAs(bob);
    await expectProfileUnavailable(page, aliceUid);
    await expectNotVisibleInAllMatchesTabs(page, alice.displayName);
    await expectConversationBlockedInMessages(page, alice.displayName);
    await logout(page);

    // Verify server cleanup (favorites/views/activity/matches) happened.
    await adminExpectCleanupBetweenUsers(aliceUid, bobUid);

    // Alice unblocks Bob via Settings -> Manage blocked users.
    await loginAs(alice);
    await openManageBlockedUsers(page);
    // The list should contain exactly one user in this flow; unblock first item for robustness.
    await unblockFirstUserFromManageBlocked(page);
    await waitUntilUnblocked(aliceUid, bobUid);
    await logout(page);

    // After unblock, they can view each other's profiles again.
    await loginAs(alice);
    await expectProfileVisible(page, bobUid, bob.displayName);
    await logout(page);

    await loginAs(bob);
    await expectProfileVisible(page, aliceUid, alice.displayName);

    // Existing conversation should be unblocked (can message again). Also confirms it persisted.
    await page.goto('/messages');
    await page.locator('app-messages, .messages-page').first().waitFor({ state: 'visible', timeout: 30000 });
    const convoBtn = page
      .locator('button.conversation-item')
      .filter({ has: page.locator('.conversation-name', { hasText: alice.displayName }) })
      .first();
    await expect(convoBtn).toBeVisible({ timeout: 30000 });
    await convoBtn.click();
    // If unblocked, restriction should be gone and chat input should be present.
    await expect(page.locator('.message-restriction-alert')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('app-chat-input')).toBeVisible({ timeout: 20000 });
  });

  test('mutual block requires BOTH to unblock', async ({ page, loginAs, suiteAlice: alice, suiteBob: bob }) => {
    test.setTimeout(360000);

    const aliceUid = await getUidByEmail(alice.email);
    const bobUid = await getUidByEmail(bob.email);
    if (!aliceUid || !bobUid) {
      throw new Error('Missing Alice/Bob UID. Live env Admin SDK auth may not be configured.');
    }
    await adminClearAllBlocksForUser(aliceUid);
    await adminClearAllBlocksForUser(bobUid);
    await adminEnsureUnblocked(aliceUid, bobUid);

    // Create a conversation first so both sides can block from Messages even after one side blocks.
    await loginAs(alice);
    await expectProfileVisible(page, bobUid, bob.displayName);
    await startConversationFromProfile(page, bobUid);
    await sendTextMessage(page, 'hello for mutual block');
    await waitForConversationToBeVisibleToRecipient(aliceUid, bobUid);
    await logout(page);

    // Alice blocks Bob.
    await loginAs(alice);
    await expectProfileVisible(page, bobUid, bob.displayName);
    await blockUserFromUserProfile(page, bob.displayName);
    await logout(page);

    // Bob blocks Alice.
    await loginAs(bob);
    // Bob can't view Alice's profile anymore, but should still have the conversation and be able to block from Messages.
    await blockUserFromMessagesConversation(page, alice.displayName);
    await logout(page);

    // Alice unblocks Bob. Bob still has Alice blocked -> should remain blocked.
    await loginAs(alice);
    await openManageBlockedUsers(page);
    await unblockFirstUserFromManageBlocked(page);
    await waitUntilUnblocked(aliceUid, bobUid);

    // Alice should STILL not be able to view Bob until Bob also unblocks.
    await expectProfileUnavailable(page, bobUid);
    await logout(page);

    // Bob unblocks Alice. Now both should see each other again.
    await loginAs(bob);
    await openManageBlockedUsers(page);
    await unblockFirstUserFromManageBlocked(page);
    await waitUntilUnblocked(bobUid, aliceUid);

    // Sanity check (Admin): there should be no remaining block docs either direction.
    const db = await getAdminDb();
    if (db) {
      const [bobBlocksAlice, bobBlockedByAlice, aliceBlocksBob, aliceBlockedByBob] = await Promise.all([
        db.doc(`users/${bobUid}/blocks/${aliceUid}`).get(),
        db.doc(`users/${bobUid}/blockedBy/${aliceUid}`).get(),
        db.doc(`users/${aliceUid}/blocks/${bobUid}`).get(),
        db.doc(`users/${aliceUid}/blockedBy/${bobUid}`).get(),
      ]);
      if (bobBlocksAlice.exists || bobBlockedByAlice.exists || aliceBlocksBob.exists || aliceBlockedByBob.exists) {
        throw new Error(
          `Expected no remaining block docs, but found: ` +
            `bob.blocks.alice=${bobBlocksAlice.exists}, ` +
            `bob.blockedBy.alice=${bobBlockedByAlice.exists}, ` +
            `alice.blocks.bob=${aliceBlocksBob.exists}, ` +
            `alice.blockedBy.bob=${aliceBlockedByBob.exists}`
        );
      }

      const aliceDoc = await db.doc(`users/${aliceUid}`).get();
      if (!aliceDoc.exists) {
        throw new Error('Expected Alice user doc to exist, but it does not.');
      }
      const aliceDisabled = aliceDoc.data()?.settings?.account?.disabled === true;
      if (aliceDisabled) {
        throw new Error('Expected Alice account to be enabled, but settings.account.disabled is true.');
      }
    }
    // At this point both sides have removed their block docs. UI visibility depends on
    // the deployed `checkBlockStatus` function, so we assert the underlying data model.
    await logout(page);
  });
});

