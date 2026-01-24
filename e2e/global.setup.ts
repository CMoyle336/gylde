import { chromium, Page } from '@playwright/test';
import { getAllTestUsers, TestUser } from './tests/fixtures/test-users';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
const AUTH_EMULATOR_URL = 'http://localhost:9099';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gylde-dba55';

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
 * Set up premium subscription for a user in Firestore emulator
 * Uses the emulator admin bypass to write directly without security rules
 */
async function setupPremiumSubscription(uid: string): Promise<boolean> {
  try {
    // Use the emulator admin token to bypass security rules
    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    };
    
    // First, get the existing private data document
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}/private/data`;
    const getUrl = `${FIRESTORE_EMULATOR_URL}/v1/${docPath}`;
    
    const getResponse = await fetch(getUrl, { headers: adminHeaders });
    
    let existingData: Record<string, unknown> = {};
    if (getResponse.ok) {
      const doc = await getResponse.json() as { fields?: Record<string, unknown> };
      existingData = doc.fields || {};
    }
    
    // Update with premium subscription
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
 * Login via UI - logs in an existing user
 * Returns: 'discover' if logged in and on discover, 'onboarding' if needs onboarding, 'failed' if login failed
 */
async function loginAs(page: Page, user: TestUser): Promise<'discover' | 'onboarding' | 'failed'> {
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
  } catch {
    return 'failed';
  }
}

/**
 * Signup via UI - creates a new user through the signup flow
 * Returns: 'created' if new user, 'exists' if user already exists, 'error' on failure
 */
async function signupAs(page: Page, user: TestUser): Promise<'created' | 'exists' | 'error'> {
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
    if (errorText?.toLowerCase().includes('already') || errorText?.toLowerCase().includes('exists')) {
      return 'exists'; // User already exists
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
 * Global setup - creates and onboards all test users
 */
async function globalSetup() {
  console.log('🚀 Global Setup: Creating test users...\n');
  
  const browser = await chromium.launch();
  const users = getAllTestUsers();
  
  for (const user of users) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
      console.log(`  Creating user: ${user.email}...`);
      const signupResult = await signupAs(page, user);
      
      if (signupResult === 'created') {
        console.log(`    ✓ Signed up, completing onboarding...`);
        await completeOnboarding(page, user);
        console.log(`    ✓ Onboarding complete`);
      } else if (signupResult === 'exists') {
        // User exists - try to log in and check if they need onboarding
        console.log(`    ⏭ User already exists, checking onboarding status...`);
        
        const loginResult = await loginAs(page, user);
        
        if (loginResult === 'onboarding') {
          console.log(`    ⚠ User needs onboarding, completing...`);
          await completeOnboarding(page, user);
          console.log(`    ✓ Onboarding complete`);
        } else if (loginResult === 'discover') {
          console.log(`    ✓ User already onboarded`);
        } else {
          console.log(`    ⚠ Could not log in to verify user status`);
        }
      }
      
      // Set up premium subscription if user should be premium
      // Note: must be done while user is still logged in on the page
      if (user.isPremium) {
        console.log(`    💎 Setting up premium subscription...`);
        const uid = await getCurrentUserUid(page);
        console.log(`      Retrieved UID: ${uid || 'null'}`);
        if (uid) {
          const success = await setupPremiumSubscription(uid);
          if (success) {
            console.log(`    ✓ Premium subscription set up for UID: ${uid}`);
          } else {
            console.log(`    ⚠ Failed to set up premium subscription`);
          }
        } else {
          console.log(`    ⚠ Could not get current user UID for premium setup`);
        }
      }
    } catch (error) {
      console.error(`    ✗ Failed to create ${user.email}:`, error);
      throw error;
    } finally {
      await context.close();
    }
  }
  
  await browser.close();
  console.log('\n✅ Global Setup complete: All test users ready\n');
}

export default globalSetup;
