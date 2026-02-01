import { Browser, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIRESTORE_EMULATOR_URL } from '../fixtures/test-users';
import type { TestUser } from '../fixtures/test-users';
import { getAdminDb, getAdminAuth, getCurrentUserUid } from './settings-helpers';
import { 
  createUserViaAdmin, 
  generateCustomToken, 
  completeOnboardingViaAdmin,
} from './admin-auth';

type ProvisionedUser = TestUser & { uid: string };

// Control verbose logging via environment variable
// Set E2E_DEBUG=true to enable detailed provisioning logs
const DEBUG = process.env.E2E_DEBUG === 'true';

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugWarn(...args: unknown[]): void {
  if (DEBUG) {
    console.warn(...args);
  }
}

/**
 * Provisioning strategy:
 * - 'admin': Use Firebase Admin SDK (no rate limits, fastest)
 * - 'ui': Use UI signup flow (subject to rate limits, but more realistic)
 * 
 * Default is 'admin' for live environments to avoid rate limits
 */
type ProvisioningStrategy = 'admin' | 'ui';

function getProvisioningStrategy(): ProvisioningStrategy {
  // Use admin strategy by default for live environments
  // Can be overridden by env var
  const override = process.env.E2E_PROVISIONING_STRATEGY;
  if (override === 'ui' || override === 'admin') {
    return override;
  }
  // Default to admin to avoid rate limits
  return 'admin';
}

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

async function uploadPhotoWithRetry(page: Page, testImagePath: string, maxRetries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Wait for upload button to be visible
      const uploadBtn = page.locator('.photo-slot.primary .photo-upload-btn');
      const hasUploadBtn = await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (!hasUploadBtn) {
        // Already have a photo uploaded
        const existingPhoto = page.locator('.photo-slot.primary .photo-preview:not(.uploading)');
        if (await existingPhoto.isVisible({ timeout: 2000 }).catch(() => false)) {
          return true;
        }
      }

      // Set files directly on the input (don't click the label, it opens file picker)
      const fileInput = page.locator('.photo-slot.primary input[type="file"]');
      await fileInput.setInputFiles(testImagePath);

      // Wait for upload to complete (preview appears without uploading class)
      // First wait for any preview to appear
      await page.locator('.photo-slot.primary .photo-preview').waitFor({ timeout: 60000 });
      
      // Then wait for it to finish uploading (no .uploading class)
      // Also check for error state
      const uploadComplete = page.locator('.photo-slot.primary img.photo-preview:not(.uploading)');
      const uploadError = page.locator('.photo-slot.primary .upload-overlay-onboarding .error-icon');
      const globalError = page.locator('.error-message[role="alert"]');

      // Race between success and error
      const result = await Promise.race([
        uploadComplete.waitFor({ timeout: 60000 }).then(() => 'success' as const),
        uploadError.waitFor({ timeout: 60000 }).then(() => 'upload-error' as const),
        globalError.waitFor({ timeout: 60000 }).then(() => 'global-error' as const),
      ]).catch(() => 'timeout' as const);

      if (result === 'success') {
        // Give a moment for any final state updates
        await page.waitForTimeout(1000);
        return true;
      }

      // Upload failed, log and potentially retry
      const errorText = await globalError.textContent().catch(() => null) ||
                        await page.locator('.upload-label.error').textContent().catch(() => null);
      console.log(`Photo upload attempt ${attempt}/${maxRetries} failed: ${result} - ${errorText || 'unknown error'}`);

      if (attempt < maxRetries) {
        // Wait before retry
        await page.waitForTimeout(2000 * attempt);
        // Try to remove failed photo if present and retry
        const removeBtn = page.locator('.photo-slot.primary .photo-remove');
        if (await removeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await removeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } catch (error) {
      console.log(`Photo upload attempt ${attempt}/${maxRetries} threw: ${error}`);
      if (attempt === maxRetries) throw error;
      await page.waitForTimeout(2000 * attempt);
    }
  }
  return false;
}

async function finishOnboardingWithRetry(page: Page, maxRetries = 3): Promise<void> {
  const timeout = isLiveEnvironment() ? 60000 : 20000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check if Next button is enabled
      const nextBtn = page.locator('.btn-next:not([disabled])');
      const isEnabled = await nextBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (!isEnabled) {
        // Button is disabled - check why
        const disabledBtn = page.locator('.btn-next[disabled]');
        if (await disabledBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log(`Attempt ${attempt}: Next button is disabled, checking for missing requirements...`);
          // Might need a photo - check if we have one
          const hasPhoto = await page.locator('.photo-slot.primary .photo-preview:not(.uploading)').isVisible().catch(() => false);
          if (!hasPhoto) {
            throw new Error('Next button disabled - likely missing required photo');
          }
          // Wait a bit and check again
          await page.waitForTimeout(2000);
          continue;
        }
      }

      await nextBtn.click();

      // Wait for either navigation to discover OR an error message
      const discoverUrl = page.waitForURL('**/discover', { timeout });
      const saveError = page.locator('.save-error, [class*="error"]').filter({ hasText: /failed|error/i });

      const result = await Promise.race([
        discoverUrl.then(() => 'success' as const),
        saveError.waitFor({ state: 'visible', timeout }).then(() => 'save-error' as const),
      ]).catch((e) => {
        // Check if we're already on discover
        if (page.url().includes('/discover')) return 'success' as const;
        throw e;
      });

      if (result === 'success') {
        return;
      }

      const errorText = await saveError.textContent().catch(() => 'unknown save error');
      console.log(`Onboarding save attempt ${attempt}/${maxRetries} failed: ${errorText}`);

      if (attempt < maxRetries) {
        await page.waitForTimeout(3000 * attempt);
      }
    } catch (error) {
      // Check if we actually made it to discover despite the error
      if (page.url().includes('/discover')) {
        return;
      }
      
      console.log(`Onboarding finish attempt ${attempt}/${maxRetries} threw: ${error}`);
      if (attempt === maxRetries) throw error;
      await page.waitForTimeout(3000 * attempt);
    }
  }

  throw new Error('Failed to complete onboarding after all retries');
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

  // Step 6: Photos - with retry logic for flaky uploads
  const testImagePath = path.join(__dirname, '..', 'fixtures', user.testImage);
  if (fs.existsSync(testImagePath)) {
    const uploadSuccess = await uploadPhotoWithRetry(page, testImagePath);
    if (!uploadSuccess) {
      throw new Error(`Failed to upload photo for user ${user.email}`);
    }
  }

  // Final step: complete onboarding with retry logic for save failures
  await finishOnboardingWithRetry(page);
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
  debugLog(`[Premium] Setting up subscription for ${uid}...`);
  
  if (isLiveEnvironment()) {
    try {
      const db = await getAdminDb();
      if (!db) {
        debugLog(`[Premium] ❌ ❌ Admin DB not available for ${uid}`);
        return false;
      }
      
      debugLog(`[Premium] Writing to users/${uid}/private/data...`);
      
      // Use update with field paths to ensure nested fields are updated correctly
      // This avoids issues with merge behavior on nested objects
      const docRef = db.doc(`users/${uid}/private/data`);
      const docSnapshot = await docRef.get();
      
      if (docSnapshot.exists) {
        // Document exists - use update with field paths
        await docRef.update({
          'subscription.tier': 'premium',
          'subscription.status': 'active',
        });
        debugLog(`[Premium] Updated existing subscription to premium`);
      } else {
        // Document doesn't exist - create it
        await docRef.set({
          subscription: { tier: 'premium', status: 'active' },
        });
        debugLog(`[Premium] Created new subscription document`);
      }
      
      // Verify the write with a small delay to account for eventual consistency
      await new Promise(resolve => setTimeout(resolve, 100));
      const verifyDoc = await docRef.get();
      const verifyData = verifyDoc.data();
      debugLog(`[Premium] Verified subscription data:`, JSON.stringify(verifyData?.subscription));
      
      if (verifyData?.subscription?.tier !== 'premium') {
        debugLog(`[Premium] ❌ ❌ Subscription tier is still "${verifyData?.subscription?.tier}" - possible Cloud Function or security rule blocking the change`);
        // Try one more time with explicit overwrite
        await docRef.set(
          { subscription: { ...verifyData?.subscription, tier: 'premium', status: 'active' } },
          { merge: true }
        );
        debugLog(`[Premium] Retried with full subscription object`);
      }
      
      debugLog(`[Premium] Writing isPremium to users/${uid}...`);
      
      // Also set denormalized isPremium flag on main user doc (used by some UI components)
      await db.doc(`users/${uid}`).set(
        { isPremium: true },
        { merge: true }
      );
      
      debugLog(`[Premium] ✓ Set up premium subscription for ${uid} (live)`);
      return true;
    } catch (error) {
      debugLog(`[Premium] ❌ ❌ Failed to set premium for ${uid}:`, error);
      return false;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer owner',
  };
  
  // Set subscription in private subcollection
  const privateDocPath = `projects/${projectId}/databases/(default)/documents/users/${uid}/private/data`;
  const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${privateDocPath}`;

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

  const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${privateDocPath}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ fields: updatedData }),
  });

  if (!patchResponse.ok) {
    debugLog(`[Premium] ❌ Failed to set subscription for ${uid} (emulator)`);
    return false;
  }
  
  // Also set denormalized isPremium flag on main user doc
  // IMPORTANT: Use updateMask to avoid overwriting the entire document
  const userDocPath = `projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const userPatchUrl = `${FIRESTORE_EMULATOR_URL}/v1/${userDocPath}?updateMask.fieldPaths=isPremium`;
  const userPatchResponse = await fetch(userPatchUrl, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ 
      fields: { 
        isPremium: { booleanValue: true } 
      } 
    }),
  });

  if (!userPatchResponse.ok) {
    debugWarn(`[Premium] Failed to set isPremium flag on user doc for ${uid}`);
  }

  debugLog(`[Premium] Set up premium subscription for ${uid} (emulator)`);
  return true;
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

/**
 * Provision a user via Firebase Admin SDK (no rate limits!)
 * This is the preferred method for live environments.
 */
async function provisionUserViaAdmin(
  uniqueUser: TestUser,
  opts: { runId: string }
): Promise<ProvisionedUser> {
  debugLog(`[Provisioning] Creating user via Admin SDK: ${uniqueUser.email}`);
  
  // Step 1: Create user via Admin SDK (no signup rate limits)
  const { uid, created } = await createUserViaAdmin(
    uniqueUser.email,
    uniqueUser.password,
    uniqueUser.displayName
  );

  // Step 2: Complete onboarding via direct Firestore writes (no UI interaction needed)
  // Use a placeholder photo URL for testing (a public image that works in tests)
  const placeholderPhotoUrl = 'https://storage.googleapis.com/gylde-sandbox.appspot.com/test-assets/placeholder-profile.jpg';
  
  await completeOnboardingViaAdmin(uid, {
    displayName: uniqueUser.displayName,
    birthDate: uniqueUser.birthDate,
    city: uniqueUser.city,
    gender: uniqueUser.gender,
    interestedIn: uniqueUser.interestedIn,
    tagline: uniqueUser.tagline,
    photoUrl: placeholderPhotoUrl,
    hasPrivateContent: uniqueUser.hasPrivateContent,
  });

  // IMPORTANT: Wait for Cloud Functions to complete before modifying private data
  // The onUserCreated Cloud Function runs when the user doc is created and sets
  // subscription.tier to "free" and initializes reputation. We need to wait for this
  // to complete before setting premium/reputation, otherwise our writes get overwritten.
  // Only wait if this is a newly created user (Cloud Functions only trigger on document creation).
  if (created && (uniqueUser.isPremium || uniqueUser.reputationTier)) {
    debugLog(`[Provisioning] Waiting 3s for Cloud Functions to process new user creation...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Step 3: Set up premium subscription if needed
  if (uniqueUser.isPremium) {
    debugLog(`[Provisioning] Setting up premium subscription for ${uid}...`);
    const premiumSuccess = await setupPremiumSubscription(uid).catch((err) => {
      debugLog(`[Provisioning] ❌ Failed to setup premium for ${uid}:`, err);
      return false;
    });
    if (premiumSuccess) {
      debugLog(`[Provisioning] ✓ Premium subscription set up for ${uid}`);
    }
  }

  // Step 4: Set up reputation tier if needed
  if (uniqueUser.reputationTier) {
    await setupReputationData(uid, uniqueUser.reputationTier).catch((err) => {
      debugWarn(`[Provisioning] Failed to setup reputation for ${uid}:`, err);
    });
  }

  appendToRegistry(opts.runId, { uid, email: uniqueUser.email });
  debugLog(`[Provisioning] User ready: ${uniqueUser.email} -> ${uid}`);
  
  return { ...uniqueUser, uid };
}

/**
 * Provision a user via UI signup flow
 * This is more realistic but subject to Firebase rate limits.
 */
async function provisionUserViaUI(
  browser: Browser,
  uniqueUser: TestUser,
  opts: { runId: string }
): Promise<ProvisionedUser> {
  debugLog(`[Provisioning] Creating user via UI: ${uniqueUser.email}`);
  
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

/**
 * Provision a user for e2e testing
 * 
 * Uses Admin SDK by default to avoid Firebase rate limits.
 * Set E2E_PROVISIONING_STRATEGY=ui to use UI signup instead.
 * Set E2E_PROVISIONING_FALLBACK=false to disable fallback to UI on admin failure.
 */
export async function provisionUser(
  browser: Browser,
  uniqueUser: TestUser,
  opts: { runId: string }
): Promise<ProvisionedUser> {
  const strategy = getProvisioningStrategy();
  const allowFallback = process.env.E2E_PROVISIONING_FALLBACK !== 'false';
  
  debugLog(`[Provisioning] Strategy: ${strategy}, Live: ${isLiveEnvironment()}, Fallback: ${allowFallback}`);
  
  if (strategy === 'admin') {
    try {
      return await provisionUserViaAdmin(uniqueUser, opts);
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      debugLog(`[Provisioning] ❌ Admin provisioning FAILED for ${uniqueUser.email}:`);
      debugLog(`[Provisioning]    Error: ${errorMessage}`);
      
      // Check if this is a credentials/configuration error
      const isConfigError = errorMessage.includes('GOOGLE_APPLICATION_CREDENTIALS') ||
                            errorMessage.includes('credentials') ||
                            errorMessage.includes('Admin Auth not available') ||
                            errorMessage.includes('Admin Firestore not available');
      
      if (isConfigError) {
        debugLog(`[Provisioning] ⚠️  This appears to be a configuration error.`);
        debugLog(`[Provisioning]    Check that GOOGLE_APPLICATION_CREDENTIALS and FIREBASE_PROJECT_ID are set correctly in e2e/.env`);
      }
      
      if (allowFallback) {
        debugWarn(`[Provisioning] ⚠️  Falling back to UI provisioning (will be rate-limited!)`);
        return await provisionUserViaUI(browser, uniqueUser, opts);
      } else {
        debugLog(`[Provisioning] ❌ Fallback disabled. Set E2E_PROVISIONING_FALLBACK=true or fix admin credentials.`);
        throw error;
      }
    }
  }
  
  debugLog(`[Provisioning] Using UI strategy for ${uniqueUser.email}`);
  return await provisionUserViaUI(browser, uniqueUser, opts);
}

/**
 * @deprecated Use provisionUser instead
 */
export async function provisionUserLegacy(
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

