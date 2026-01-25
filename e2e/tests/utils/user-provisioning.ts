import { Browser, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIRESTORE_EMULATOR_URL } from '../fixtures/test-users';
import type { TestUser } from '../fixtures/test-users';
import { getAdminDb, getCurrentUserUid } from './settings-helpers';

type ProvisionedUser = TestUser & { uid: string };

function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

function tmpDir(): string {
  return path.resolve(__dirname, '..', '..', '.tmp');
}

export function getRunId(): string {
  const p = path.join(tmpDir(), 'run-id.txt');
  try {
    const runId = fs.readFileSync(p, 'utf8').trim();
    if (runId) return runId;
  } catch {
    // ignore
  }
  // Fallback (should not happen if globalSetup ran)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function registryPathForRun(runId: string): string {
  return path.join(tmpDir(), `created-users.${runId}.jsonl`);
}

function appendToRegistry(runId: string, entry: { uid: string; email: string }): void {
  const p = registryPathForRun(runId);
  const line = JSON.stringify({ ...entry, createdAt: new Date().toISOString() }) + '\n';
  try {
    fs.appendFileSync(p, line, 'utf8');
  } catch {
    // best-effort
  }
}

function shortId(input: string): string {
  // lightweight stable-ish shortening (no crypto dependency)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

export function makeUniqueUser(template: TestUser, opts: { runId: string; workerIndex: number; testId: string; label?: string }): TestUser {
  const label = (opts.label || template.id || 'user').replace(/[^a-z0-9_-]/gi, '').slice(0, 18);
  const suffix = `${opts.runId.slice(-6)}-${opts.workerIndex}-${shortId(opts.testId)}-${Math.random().toString(36).slice(2, 6)}`;
  const uniqueId = `${template.id}-${label}-${suffix}`;

  const emailLocal = `${label}.${suffix}`.replace(/[^a-z0-9._-]/gi, '').slice(0, 40);
  const email = `${emailLocal}@e2e.test`;
  const displayName = `${template.displayName} ${suffix}`.slice(0, 40);

  return {
    ...template,
    id: uniqueId,
    email,
    displayName,
    storageStatePath: `.auth/${uniqueId}.json`,
  };
}

async function openAuthModal(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const getStartedBtn = page.getByRole('button', { name: /get started/i });
  await getStartedBtn.waitFor({ state: 'visible', timeout: 15000 });
  await getStartedBtn.click();
  await page.locator('.modal-backdrop').waitFor({ timeout: 15000 });
}

async function signupViaUI(page: Page, user: TestUser, retryCount = 0): Promise<void> {
  await openAuthModal(page);

  // Ensure we're in signup mode. Modal usually opens in signup mode, but the switch button label can vary.
  const authSwitch = page.locator('.auth-switch button');
  const switchText = (await authSwitch.textContent().catch(() => ''))?.toLowerCase() || '';
  if (switchText.includes('sign up')) {
    await authSwitch.click().catch(() => {});
  }

  await page.getByRole('textbox', { name: 'Display Name' }).fill(user.displayName);
  await page.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(user.password);
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(user.password);
  await page.locator('.submit-btn').click();

  try {
    await page.waitForURL('**/onboarding', { timeout: isLiveEnvironment() ? 60000 : 20000 });
    return;
  } catch {
    const errorText = (await page.locator('[role="alert"]').textContent().catch(() => '')) || '';
    const normalized = errorText.toLowerCase();
    const isRateLimited =
      normalized.includes('too many') ||
      normalized.includes('try again later') ||
      normalized.includes('rate') ||
      normalized.includes('throttle') ||
      normalized.includes('quota');

    if (isRateLimited && retryCount < 5) {
      const backoffMs = (isLiveEnvironment() ? 12000 : 2000) * (retryCount + 1) + Math.floor(Math.random() * 1000);
      await page.waitForTimeout(backoffMs);
      return signupViaUI(page, user, retryCount + 1);
    }

    throw new Error(`Signup failed for ${user.email}: ${errorText}`);
  }
}

async function clickNextButton(page: Page, timeout = 15000): Promise<void> {
  const nextBtn = page.locator('.btn-next:not([disabled])');
  await nextBtn.waitFor({ state: 'visible', timeout });
  await nextBtn.click();
}

async function selectYear(page: Page, targetYear: number): Promise<void> {
  const yearSelector = page.locator(`text="${targetYear}"`).first();
  for (let i = 0; i < 10; i++) {
    if (await yearSelector.isVisible({ timeout: 500 }).catch(() => false)) {
      await yearSelector.click();
      return;
    }
    const prevButton = page.locator('.mat-calendar-previous-button:not([disabled]):not([aria-disabled="true"])');
    if (await prevButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await prevButton.click();
      await page.waitForTimeout(300);
    } else {
      break;
    }
  }
  await yearSelector.click({ timeout: 10000 });
}

async function completeOnboarding(page: Page, user: TestUser): Promise<void> {
  if (!page.url().includes('/onboarding')) return;

  // Step 1: Eligibility
  await page.locator('.datepicker-toggle').click();
  await page.locator('.mat-calendar').waitFor();
  await page.waitForTimeout(500);

  const birthYear = user.birthDate.getFullYear();
  const birthMonth = user.birthDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  await selectYear(page, birthYear);
  await page.getByRole('button', { name: birthMonth }).click();
  await page.getByRole('gridcell', { name: String(user.birthDate.getDate()) }).click();

  await page.locator('input[role="combobox"]').waitFor();
  await page.locator('input[role="combobox"]').fill(user.city);
  await page.waitForTimeout(1000);
  await page.locator('.suggestion-item').first().click();
  await clickNextButton(page);

  // Step 2: Identity
  await page.locator(`label[for="gender-${user.gender}"]`).waitFor();
  await page.locator(`label[for="gender-${user.gender}"]`).click();
  for (const interest of user.interestedIn) {
    await page.locator(`label[for="interested-${interest}"]`).click();
  }
  await clickNextButton(page);

  // Step 3: Intent
  await page.locator('.options-grid .option-chip').first().waitFor();
  await page.locator('.options-grid .option-chip').first().click();
  await clickNextButton(page);

  // Step 4: Age Range (optional)
  await clickNextButton(page);

  // Step 5: Prompts
  await page.locator('#tagline').waitFor();
  await page.locator('#tagline').fill(user.tagline);
  await page.locator('#ideal-relationship').fill('Someone who values honesty.');
  await clickNextButton(page);

  // Step 6: Photos
  const testImagePath = path.join(__dirname, '..', 'fixtures', user.testImage);
  if (fs.existsSync(testImagePath)) {
    await page.locator('.photo-upload-btn').first().waitFor();
    await page.locator('.photo-upload-btn').first().click();
    await page.waitForTimeout(100);
    await page.locator('.photo-slot.primary input[type="file"]').setInputFiles(testImagePath);
    await page.locator('.photo-slot.primary .photo-preview').waitFor({ timeout: 60000 });
    await page.locator('.photo-slot.primary .photo-preview:not(.uploading)').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  await clickNextButton(page, 60000);
  await page.waitForURL('**/discover', { timeout: isLiveEnvironment() ? 60000 : 20000 });
}

const TIER_SCORES: Record<string, number> = {
  new: 100,
  active: 200,
  established: 400,
  trusted: 600,
  distinguished: 800,
};

const TIER_LIMITS: Record<string, number> = {
  new: 1,
  active: 3,
  established: 5,
  trusted: 10,
  distinguished: -1,
};

async function setupPremiumSubscription(uid: string): Promise<boolean> {
  if (isLiveEnvironment()) {
    const db = await getAdminDb();
    if (!db) return false;
    await db.doc(`users/${uid}/private/data`).set(
      { subscription: { tier: 'premium', status: 'active' } },
      { merge: true }
    );
    return true;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer owner',
  };
  const docPath = `projects/${projectId}/databases/(default)/documents/users/${uid}/private/data`;
  const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;

  const getResponse = await fetch(getUrl, { headers: adminHeaders });
  let existingData: Record<string, unknown> = {};
  if (getResponse.ok) {
    const doc = (await getResponse.json()) as { fields?: Record<string, unknown> };
    existingData = doc.fields || {};
  }

  const updatedData = {
    ...existingData,
    subscription: {
      mapValue: {
        fields: {
          tier: { stringValue: 'premium' },
          status: { stringValue: 'active' },
        },
      },
    },
  };

  const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${docPath}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ fields: updatedData }),
  });

  return patchResponse.ok;
}

async function setupReputationData(uid: string, tier: string): Promise<boolean> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  if (isLiveEnvironment()) {
    const db = await getAdminDb();
    if (!db) return false;
    await db.doc(`users/${uid}/private/data`).set(
      {
        reputation: {
          tier,
          score: TIER_SCORES[tier] || 100,
          dailyHigherTierConversationLimit: TIER_LIMITS[tier] ?? 1,
          higherTierConversationsToday: 0,
          lastConversationDate: today,
          lastCalculatedAt: now,
          tierChangedAt: now,
          createdAt: now,
          signals: {
            profileCompletion: 100,
            identityVerified: true,
            accountAgeDays: 30,
            responseRate: 0.8,
            conversationQuality: 0.7,
            blockRatio: 0,
            reportRatio: 0,
            ghostRate: 0.1,
            burstScore: 0,
          },
        },
      },
      { merge: true }
    );
    return true;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer owner',
  };
  const docPath = `projects/${projectId}/databases/(default)/documents/users/${uid}/private/data`;
  const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;

  const getResponse = await fetch(getUrl, { headers: adminHeaders });
  let existingData: Record<string, unknown> = {};
  if (getResponse.ok) {
    const doc = (await getResponse.json()) as { fields?: Record<string, unknown> };
    existingData = doc.fields || {};
  }

  const nowIso = now.toISOString();
  const reputationFields = {
    tier: { stringValue: tier },
    score: { integerValue: String(TIER_SCORES[tier] || 100) },
    dailyHigherTierConversationLimit: { integerValue: String(TIER_LIMITS[tier] ?? 1) },
    higherTierConversationsToday: { integerValue: '0' },
    lastConversationDate: { stringValue: today },
    lastCalculatedAt: { timestampValue: nowIso },
    tierChangedAt: { timestampValue: nowIso },
    createdAt: { timestampValue: nowIso },
    signals: {
      mapValue: {
        fields: {
          profileCompletion: { integerValue: '100' },
          identityVerified: { booleanValue: true },
          accountAgeDays: { integerValue: '30' },
          responseRate: { doubleValue: 0.8 },
          conversationQuality: { doubleValue: 0.7 },
          blockRatio: { doubleValue: 0 },
          reportRatio: { doubleValue: 0 },
          ghostRate: { doubleValue: 0.1 },
          burstScore: { doubleValue: 0 },
        },
      },
    },
  };

  const updatedData = {
    ...existingData,
    reputation: {
      mapValue: { fields: reputationFields },
    },
  };

  const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${docPath}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ fields: updatedData }),
  });

  return patchResponse.ok;
}

export async function provisionUser(
  browser: Browser,
  uniqueUser: TestUser,
  opts: { runId: string }
): Promise<ProvisionedUser> {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signupViaUI(page, uniqueUser);
    await completeOnboarding(page, uniqueUser);

    const uid = await getCurrentUserUid(page);
    if (!uid) {
      throw new Error(`Could not read UID after signup for ${uniqueUser.email}`);
    }

    if (uniqueUser.isPremium) {
      await setupPremiumSubscription(uid).catch(() => {});
    }
    if (uniqueUser.reputationTier) {
      await setupReputationData(uid, uniqueUser.reputationTier).catch(() => {});
    }

    appendToRegistry(opts.runId, { uid, email: uniqueUser.email });
    return { ...uniqueUser, uid };
  } finally {
    await context.close();
  }
}

export type { ProvisionedUser };

