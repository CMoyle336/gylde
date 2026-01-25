import { chromium, Browser, Page } from '@playwright/test';
import { getAllTestUsers, TestUser } from './tests/fixtures/test-users';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
const AUTH_EMULATOR_URL = 'http://localhost:9099';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';

// Detect if running against live environment
const isLiveEnv = BASE_URL.includes('gylde.com');

// Firebase Admin SDK - only loaded for live environments
let adminDb: FirebaseFirestore.Firestore | null = null;

async function initFirebaseAdmin(): Promise<void> {
  if (!isLiveEnv || adminDb) return;
  
  try {
    const { initializeApp, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    
    initializeApp({
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
    });
    
    adminDb = getFirestore();
    console.log('   ✓ Firebase Admin SDK initialized for live environment');
  } catch (error) {
    console.log('   ⚠ Could not initialize Firebase Admin SDK:', error);
    console.log('     Premium/reputation setup will be skipped.');
    console.log('     Run: gcloud auth application-default set-quota-project gylde-sandbox');
  }
}

// Maximum number of users to create in parallel
// Limit for live environments to reduce Firebase auth quota pressure
const MAX_PARALLEL_USERS = 5;

/**
 * Get current user's UID from the browser page
 * Reads Firebase auth state from IndexedDB
 */
async function getCurrentUserUid(page: Page): Promise<string | null> {
  try {
    // Wait a moment for IndexedDB to be populated
    await page.waitForTimeout(500);
    
    // Get UID from IndexedDB where Firebase stores auth state
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
        
        // Timeout after 2 seconds
        setTimeout(() => resolve(null), 2000);
      });
    });
    
    if (uid) {
      return uid;
    }
    
    // Fallback: Check for firebase auth patterns in localStorage
    const localStorageUid = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('firebase:authUser') || key.includes('firebaseui'))) {
          try {
            const value = localStorage.getItem(key);
            if (value) {
              const parsed = JSON.parse(value);
              if (parsed.uid) return parsed.uid;
              if (parsed.user?.uid) return parsed.user.uid;
            }
          } catch {
            continue;
          }
        }
      }
      return null;
    });
    
    return localStorageUid;
  } catch (error) {
    console.log(`    ⚠ Error getting current user UID: ${error}`);
    return null;
  }
}

/**
 * Set up premium subscription for a user in Firestore
 * Uses emulator REST API for local, Admin SDK for live
 */
async function setupPremiumSubscription(uid: string): Promise<boolean> {
  // Live environment: use Admin SDK
  if (isLiveEnv) {
    if (!adminDb) return false;
    
    try {
      const docRef = adminDb.doc(`users/${uid}/private/data`);
      await docRef.set({
        subscription: {
          tier: 'premium',
          status: 'active',
        },
      }, { merge: true });
      return true;
    } catch (error) {
      console.error(`    ⚠ Exception in setupPremiumSubscription (live):`, error);
      return false;
    }
  }
  
  // Local environment: use emulator REST API
  try {
    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    };
    
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}/private/data`;
    const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;
    
    const getResponse = await fetch(getUrl, { headers: adminHeaders });
    
    let existingData: Record<string, unknown> = {};
    if (getResponse.ok) {
      const doc = await getResponse.json() as { fields?: Record<string, unknown> };
      existingData = doc.fields || {};
    }
    
    const subscriptionFields = {
      tier: { stringValue: 'premium' },
      status: { stringValue: 'active' },
    };
    
    const updatedData = {
      ...existingData,
      subscription: {
        mapValue: {
          fields: subscriptionFields,
        },
      },
    };
    
    const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${docPath}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ fields: updatedData }),
    });
    
    if (!patchResponse.ok) {
      const errorText = await patchResponse.text().catch(() => 'unknown');
      console.log(`      PATCH error: ${patchResponse.status} - ${errorText}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`    ⚠ Exception in setupPremiumSubscription:`, error);
    return false;
  }
}

/**
 * Reputation tier score thresholds (from REPUTATION_CONFIG)
 */
const TIER_SCORES: Record<string, number> = {
  new: 100,        // Below 150
  active: 200,     // 150+
  established: 400, // 350+
  trusted: 600,    // 550+
  distinguished: 800, // 750+
};

/**
 * Daily higher-tier conversation limits by tier
 */
const TIER_LIMITS: Record<string, number> = {
  new: 1,
  active: 3,
  established: 5,
  trusted: 10,
  distinguished: -1, // unlimited
};

/**
 * Set up reputation data for a user in Firestore
 * Uses emulator REST API for local, Admin SDK for live
 */
async function setupReputationData(uid: string, tier: string): Promise<boolean> {
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  const reputationData = {
    tier,
    score: TIER_SCORES[tier] || 100,
    dailyHigherTierConversationLimit: TIER_LIMITS[tier] || 1,
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
  };
  
  // Live environment: use Admin SDK
  if (isLiveEnv) {
    if (!adminDb) return false;
    
    try {
      const docRef = adminDb.doc(`users/${uid}/private/data`);
      await docRef.set({ reputation: reputationData }, { merge: true });
      return true;
    } catch (error) {
      console.error(`    ⚠ Exception in setupReputationData (live):`, error);
      return false;
    }
  }
  
  // Local environment: use emulator REST API
  try {
    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    };
    
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}/private/data`;
    const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;
    
    const getResponse = await fetch(getUrl, { headers: adminHeaders });
    
    let existingData: Record<string, unknown> = {};
    if (getResponse.ok) {
      const doc = await getResponse.json() as { fields?: Record<string, unknown> };
      existingData = doc.fields || {};
    }
    
    const nowIso = now.toISOString();
    
    const reputationFields = {
      tier: { stringValue: tier },
      score: { integerValue: String(TIER_SCORES[tier] || 100) },
      dailyHigherTierConversationLimit: { integerValue: String(TIER_LIMITS[tier] || 1) },
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
        mapValue: {
          fields: reputationFields,
        },
      },
    };
    
    const patchResponse = await fetch(`${FIRESTORE_EMULATOR_URL}/v1/${docPath}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ fields: updatedData }),
    });
    
    if (!patchResponse.ok) {
      const errorText = await patchResponse.text().catch(() => 'unknown');
      console.log(`      PATCH error: ${patchResponse.status} - ${errorText}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`    ⚠ Exception in setupReputationData:`, error);
    return false;
  }
}

/**
 * Login via UI - logs in an existing user
 * Returns: 'discover' if logged in and on discover, 'onboarding' if needs onboarding, 'failed' if login failed
 */
async function loginAs(page: Page, user: TestUser, retryCount = 0): Promise<'discover' | 'onboarding' | 'failed'> {
  // Add delay for live environment to avoid quota issues
  if (isLiveEnv && retryCount > 0) {
    await page.waitForTimeout(3000 * retryCount); // Exponential backoff
  }
  
  await page.goto(BASE_URL);
  
  // Open auth modal
  await page.getByRole('button', { name: /get started/i }).click();
  await page.locator('.modal-backdrop').waitFor();
  
  // Switch to login mode - the button shows "Sign in" when we're in signup mode
  // Click it to switch to sign in (login) mode
  const authSwitch = page.locator('.auth-switch button');
  const switchText = await authSwitch.textContent();
  // If the button says "Sign in" or similar, click to switch to login mode
  if (switchText?.toLowerCase().includes('sign in') || switchText?.toLowerCase().includes('login') || switchText?.toLowerCase().includes('log in')) {
    await authSwitch.click();
    await page.waitForTimeout(300); // Wait for mode switch
  }
  
  // Fill login form
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  
  // Submit
  await page.locator('.submit-btn').click();
  
  // Wait for redirect
  try {
    await page.waitForURL(/\/(discover|onboarding|messages|settings|favorites)/, { timeout: 15000 });
    if (page.url().includes('/onboarding')) {
      return 'onboarding';
    }
    return 'discover';
  } catch (error) {
    // Check for quota exceeded error and retry
    const errorText = await page.locator('[role="alert"]').textContent().catch(() => '');
    if (errorText?.includes('quota') && retryCount < 3) {
      console.log(`  [${user.displayName}] Quota exceeded, waiting and retrying...`);
      await page.waitForTimeout(5000 * (retryCount + 1));
      return loginAs(page, user, retryCount + 1);
    }
    return 'failed';
  }
}

/**
 * Signup via UI - creates a new user through the signup flow
 * Returns: 'created' if new user, 'exists' if user already exists, 'error' on failure
 */
async function signupAs(page: Page, user: TestUser, retryCount = 0): Promise<'created' | 'exists' | 'error'> {
  await page.goto(BASE_URL);
  
  // Open auth modal
  await page.getByRole('button', { name: /get started/i }).click();
  await page.locator('.modal-backdrop').waitFor();
  
  // Should already be in signup mode by default, but ensure we're there
  const authSwitch = page.locator('.auth-switch button');
  const switchText = await authSwitch.textContent();
  if (switchText?.toLowerCase().includes('sign up')) {
    await authSwitch.click();
  }
  
  // Fill signup form
  await page.getByRole('textbox', { name: 'Display Name' }).fill(user.displayName);
  await page.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(user.password);
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(user.password);
  
  // Submit
  await page.locator('.submit-btn').click();
  
  // Wait for redirect to onboarding or error
  try {
    await page.waitForURL('**/onboarding', { timeout: 10000 });
    return 'created';
  } catch {
    // Check if email already exists
    const errorText = await page.locator('[role="alert"]').textContent().catch(() => '');
    const normalized = (errorText || '').toLowerCase();
    if (normalized.includes('already') || normalized.includes('exists')) {
      return 'exists'; // User already exists
    }

    // Live env can hit Firebase Auth throttling. If we get rate-limited, try to login
    // (in case the user was created in a prior run), otherwise backoff + retry.
    const isRateLimited =
      normalized.includes('too many attempts') ||
      normalized.includes('try again later') ||
      normalized.includes('rate') ||
      normalized.includes('throttle');

    if (isRateLimited) {
      if (retryCount < 3) {
        // Try login first (covers "already exists" but different error strings).
        const loginResult = await loginAs(page, user).catch(() => 'failed' as const);
        if (loginResult !== 'failed') {
          return 'exists';
        }

        const backoffMs = 10000 * (retryCount + 1) + Math.floor(Math.random() * 2000);
        console.log(`  [${user.displayName}] Rate-limited on signup, retrying in ${Math.round(backoffMs / 1000)}s...`);
        await page.waitForTimeout(backoffMs);
        return signupAs(page, user, retryCount + 1);
      }
    }

    throw new Error(`Signup failed for ${user.email}: ${errorText}`);
  }
}

/**
 * Helper to click the next button after waiting for it to be enabled
 */
async function clickNextButton(page: Page, timeout = 10000): Promise<void> {
  const nextBtn = page.locator('.btn-next:not([disabled])');
  await nextBtn.waitFor({ state: 'visible', timeout });
  await nextBtn.click();
}

/**
 * Select year in Angular Material datepicker, navigating if needed
 */
async function selectYear(page: Page, targetYear: number): Promise<void> {
  // In Angular Material multi-year view, years are shown in cells with class mat-calendar-body-cell-content
  // The year text is inside a span with that class
  const yearSelector = page.locator(`text="${targetYear}"`).first();
  
  // Try up to 10 times to navigate backwards to find the year
  for (let i = 0; i < 10; i++) {
    if (await yearSelector.isVisible({ timeout: 500 }).catch(() => false)) {
      await yearSelector.click();
      return;
    }
    
    // Try to find an enabled previous button
    const prevButton = page.locator('.mat-calendar-previous-button:not([disabled]):not([aria-disabled="true"])');
    if (await prevButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await prevButton.click();
      await page.waitForTimeout(300);
    } else {
      // No enabled nav button available, break
      break;
    }
  }
  
  // Final attempt
  await yearSelector.click({ timeout: 10000 });
}

/**
 * Complete onboarding for a user
 */
async function completeOnboarding(page: Page, user: TestUser): Promise<void> {
  if (!page.url().includes('/onboarding')) {
    return;
  }

  // Step 1: Eligibility - Birthday and Location
  await page.locator('.datepicker-toggle').click();
  await page.locator('.mat-calendar').waitFor();
  // Wait for calendar content to fully render
  await page.waitForTimeout(500);

  const birthYear = user.birthDate.getFullYear();
  const birthMonth = user.birthDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();

  // Navigate to and select the birth year
  await selectYear(page, birthYear);
  await page.getByRole('button', { name: birthMonth }).click();
  await page.getByRole('gridcell', { name: String(user.birthDate.getDate()) }).click();

  // Location
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

  // Step 4: Age Range (optional, just click next)
  await clickNextButton(page);

  // Step 5: Prompts
  await page.locator('#tagline').waitFor();
  await page.locator('#tagline').fill(user.tagline);
  await page.locator('#ideal-relationship').fill('Someone who values honesty.');
  await clickNextButton(page);

  // Step 6: Photos
  const testImagePath = path.join(__dirname, 'tests', 'fixtures', user.testImage);
  if (fs.existsSync(testImagePath)) {
    await page.locator('.photo-upload-btn').first().waitFor();
    await page.locator('.photo-upload-btn').first().click();
    await page.waitForTimeout(100);
    await page.locator('.photo-slot.primary input[type="file"]').setInputFiles(testImagePath);
    
    // Wait for the photo preview to appear
    await page.locator('.photo-slot.primary .photo-preview').waitFor({ timeout: 60000 });
    
    // Wait for upload to complete (uploading class to be removed)
    await page.locator('.photo-slot.primary .photo-preview:not(.uploading)').waitFor({ timeout: 60000 });
    
    // Additional wait for any processing
    await page.waitForTimeout(2000);
  }

  // Finish - wait longer for the button to be enabled after photo upload
  await clickNextButton(page, 60000);
  await page.waitForURL('**/discover', { timeout: 15000 });
}

/**
 * Create and onboard a single user
 */
async function createUser(browser: Browser, user: TestUser): Promise<{ email: string; success: boolean; error?: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`  [${user.displayName}] Starting...`);
    const signupResult = await signupAs(page, user);
    
    if (signupResult === 'created') {
      console.log(`  [${user.displayName}] Signed up, completing onboarding...`);
      await completeOnboarding(page, user);
      console.log(`  [${user.displayName}] Onboarding complete`);
    } else if (signupResult === 'exists') {
      console.log(`  [${user.displayName}] Already exists, checking onboarding...`);
      
      const loginResult = await loginAs(page, user);
      
      if (loginResult === 'onboarding') {
        console.log(`  [${user.displayName}] Completing onboarding...`);
        await completeOnboarding(page, user);
        console.log(`  [${user.displayName}] Onboarding complete`);
      } else if (loginResult === 'discover') {
        console.log(`  [${user.displayName}] Already onboarded`);
      } else {
        console.log(`  [${user.displayName}] Could not verify status`);
      }
    }
    
    // Get UID for setting up premium and reputation
    const uid = await getCurrentUserUid(page);
    
    // Set up premium subscription if user should be premium
    if (user.isPremium && uid) {
      console.log(`  [${user.displayName}] Setting up premium...`);
      const success = await setupPremiumSubscription(uid);
      if (success) {
        console.log(`  [${user.displayName}] ✓ Premium set up`);
      } else {
        console.log(`  [${user.displayName}] ⚠ Premium setup failed`);
      }
    }
    
    // Set up reputation tier if specified
    if (user.reputationTier && uid) {
      console.log(`  [${user.displayName}] Setting up reputation (${user.reputationTier})...`);
      const success = await setupReputationData(uid, user.reputationTier);
      if (success) {
        console.log(`  [${user.displayName}] ✓ Reputation set up`);
      } else {
        console.log(`  [${user.displayName}] ⚠ Reputation setup failed`);
      }
    }
    
    console.log(`  [${user.displayName}] ✓ Done`);
    return { email: user.email, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  [${user.displayName}] ✗ Failed: ${errorMsg}`);
    return { email: user.email, success: false, error: errorMsg };
  } finally {
    await context.close();
  }
}

/**
 * Process users in parallel with concurrency limit
 */
async function processInParallel<T, R>(
  items: T[],
  maxConcurrent: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });
    
    executing.push(promise);
    
    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const p = executing[i];
        // Check if promise is settled by racing with an immediate resolve
        const isSettled = await Promise.race([
          p.then(() => true).catch(() => true),
          Promise.resolve(false)
        ]);
        if (isSettled) {
          executing.splice(i, 1);
        }
      }
    }
  }
  
  // Wait for all remaining promises
  await Promise.all(executing);
  
  return results;
}

/**
 * Global setup - creates and onboards all test users in parallel
 */
async function globalSetup() {
  console.log('🚀 Global Setup: Creating test users...\n');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Environment: ${isLiveEnv ? 'LIVE' : 'LOCAL EMULATOR'}`);
  console.log(`   Running with up to ${MAX_PARALLEL_USERS} parallel operations\n`);
  
  // Initialize Firebase Admin for live environments
  if (isLiveEnv) {
    await initFirebaseAdmin();
  }
  
  const browser = await chromium.launch();
  const users = getAllTestUsers();
  
  const startTime = Date.now();
  
  // Process users in parallel with concurrency limit
  const results = await processInParallel(
    users,
    MAX_PARALLEL_USERS,
    (user) => createUser(browser, user)
  );
  
  await browser.close();
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Global Setup complete in ${elapsed}s`);
  console.log(`   ${succeeded}/${results.length} users ready`);
  
  if (failed.length > 0) {
    console.log(`   Failed users: ${failed.map(f => f.email).join(', ')}`);
    throw new Error(`Failed to create ${failed.length} users`);
  }
  
  console.log('');
}

export default globalSetup;
