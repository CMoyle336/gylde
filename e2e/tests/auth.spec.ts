import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('Auth Modal - Login Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.locator('.modal-backdrop').waitFor();
    });

    test('displays login form with email and password fields', async ({ page }) => {
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
    });

    test('has email and phone login method toggle', async ({ page }) => {
      const emailToggle = page.getByRole('button', { name: /email/i });
      const phoneToggle = page.getByRole('button', { name: /phone/i });

      await expect(emailToggle).toBeVisible();
      await expect(phoneToggle).toBeVisible();
    });

    test('switches to phone login when phone toggle is clicked', async ({ page }) => {
      await page.getByRole('button', { name: /phone/i }).click();

      // Should show phone number input
      await expect(page.locator('#phoneNumber')).toBeVisible();
      // Email/password fields should be hidden
      await expect(page.locator('#email')).not.toBeVisible();
    });

    test('has forgot password link', async ({ page }) => {
      const forgotLink = page.getByRole('button', { name: /forgot password/i });
      await expect(forgotLink).toBeVisible();
    });

    test('switches to password reset mode when forgot password is clicked', async ({ page }) => {
      await page.getByRole('button', { name: /forgot password/i }).click();

      // Should only show email field, no password
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).not.toBeVisible();
    });

    test('has Google sign-in button', async ({ page }) => {
      const googleBtn = page.locator('.google-btn');
      await expect(googleBtn).toBeVisible();
      await expect(googleBtn).toContainText(/google/i);
    });

    test('has link to switch to signup mode', async ({ page }) => {
      const signupLink = page.locator('.auth-switch button');
      await expect(signupLink).toBeVisible();
    });

    test('closes modal when close button is clicked', async ({ page }) => {
      await page.locator('.modal-close').click();
      await expect(page.locator('.modal-backdrop')).not.toBeVisible();
    });

    test('closes modal when clicking backdrop', async ({ page }) => {
      // Click on the backdrop (outside the modal container)
      await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.modal-backdrop')).not.toBeVisible();
    });
  });

  test.describe('Auth Modal - Signup Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /get started/i }).click();
      await page.locator('.modal-backdrop').waitFor();
    });

    test('displays signup form with name, email, and password fields', async ({ page }) => {
      await expect(page.locator('#displayName')).toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('#confirmPassword')).toBeVisible();
    });

    test('has Google sign-in option', async ({ page }) => {
      const googleBtn = page.locator('.google-btn');
      await expect(googleBtn).toBeVisible();
    });

    test('has link to switch to login mode', async ({ page }) => {
      const loginLink = page.locator('.auth-switch button');
      await expect(loginLink).toBeVisible();
    });

    test('switches to login mode when login link is clicked', async ({ page }) => {
      await page.locator('.auth-switch button').click();

      // Should show login form (no displayName field)
      await expect(page.locator('#displayName')).not.toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
    });
  });

  test.describe('Form Validation', () => {
    test('login submit button is initially enabled (validation on submit)', async ({ page }) => {
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.locator('.modal-backdrop').waitFor();

      const submitBtn = page.locator('.submit-btn');
      await expect(submitBtn).toBeEnabled();
    });

    test('signup form allows input in all fields', async ({ page }) => {
      await page.getByRole('button', { name: /get started/i }).click();
      await page.locator('.modal-backdrop').waitFor();

      await page.locator('#displayName').fill('Test User');
      await page.locator('#email').fill('test@example.com');
      await page.locator('#password').fill('password123');
      await page.locator('#confirmPassword').fill('password123');

      // Verify values were entered
      await expect(page.locator('#displayName')).toHaveValue('Test User');
      await expect(page.locator('#email')).toHaveValue('test@example.com');
    });
  });
});
