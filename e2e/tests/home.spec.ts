import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Gylde/i);
  });

  test.describe('Header', () => {
    test('displays header with navigation', async ({ page }) => {
      const header = page.locator('header.public-header');
      await expect(header).toBeVisible();
    });

    test('has Sign In button', async ({ page }) => {
      const signInButton = page.getByRole('button', { name: /sign in/i });
      await expect(signInButton).toBeVisible();
    });

    test('has Get Started button', async ({ page }) => {
      const getStartedButton = page.getByRole('button', { name: /get started/i });
      await expect(getStartedButton).toBeVisible();
    });
  });

  test.describe('Hero Section', () => {
    test('displays hero heading', async ({ page }) => {
      const heroHeading = page.getByRole('heading', { name: /a more trustworthy way to connect/i });
      await expect(heroHeading).toBeVisible();
    });

    test('displays hero description', async ({ page }) => {
      const description = page.getByText(/gylde rewards respect, consistency, and real intent/i);
      await expect(description).toBeVisible();
    });

    test('displays Request Early Access button', async ({ page }) => {
      const ctaButton = page.locator('.hero').getByRole('button', { name: /request early access/i });
      await expect(ctaButton).toBeVisible();
    });

    test('displays How Reputation Works link', async ({ page }) => {
      const link = page.getByRole('link', { name: /how reputation works/i });
      await expect(link).toBeVisible();
    });

    test('displays floating trust cards', async ({ page }) => {
      await expect(page.getByText('Reputation verified')).toBeVisible();
      await expect(page.getByText('Trust earned')).toBeVisible();
      await expect(page.getByText('Quality protected')).toBeVisible();
    });
  });

  test.describe('Problem Section', () => {
    test('displays problem section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /why existing platforms feel broken/i });
      await expect(heading).toBeVisible();
    });

    test('displays problem statements', async ({ page }) => {
      await expect(page.getByText(/visibility shouldn't be something you buy/i)).toBeVisible();
      await expect(page.getByText(/trust shouldn't reset every time you log in/i)).toBeVisible();
    });
  });

  test.describe('Promise Section (Three Pillars)', () => {
    test('displays promise section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /what we do instead/i });
      await expect(heading).toBeVisible();
    });

    test('displays three pillars', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Reputation Over Reach' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Protection for Quality' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /trust that can't be bought/i })).toBeVisible();
    });
  });

  test.describe('Audience Section', () => {
    test('displays audience section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /gylde is for some people—not everyone/i });
      await expect(heading).toBeVisible();
    });

    test('displays "Gylde is for" list', async ({ page }) => {
      await expect(page.getByText('Value discretion and respect')).toBeVisible();
      await expect(page.getByText('Prefer quality over volume')).toBeVisible();
    });

    test('displays "Gylde is not for" list', async ({ page }) => {
      await expect(page.getByText('Mass messaging')).toBeVisible();
      await expect(page.getByText('Low-effort behavior')).toBeVisible();
    });
  });

  test.describe('CTA Section', () => {
    test('displays final CTA heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /join the right way/i });
      await expect(heading).toBeVisible();
    });

    test('displays final Request Early Access button', async ({ page }) => {
      const ctaSection = page.locator('.cta');
      const ctaButton = ctaSection.getByRole('button', { name: /request early access/i });
      await expect(ctaButton).toBeVisible();
    });
  });

  test.describe('Footer', () => {
    test('displays footer', async ({ page }) => {
      const footer = page.locator('footer');
      await expect(footer).toBeVisible();
    });
  });

  test.describe('Auth Modal', () => {
    test('opens auth modal when clicking Sign In', async ({ page }) => {
      await page.getByRole('button', { name: /sign in/i }).click();
      
      const authModal = page.locator('.modal-backdrop');
      await expect(authModal).toBeVisible();
    });

    test('opens auth modal when clicking Get Started', async ({ page }) => {
      await page.getByRole('button', { name: /get started/i }).click();
      
      const authModal = page.locator('.modal-backdrop');
      await expect(authModal).toBeVisible();
    });

    test('opens auth modal when clicking Request Early Access', async ({ page }) => {
      await page.locator('.hero').getByRole('button', { name: /request early access/i }).click();
      
      const authModal = page.locator('.modal-backdrop');
      await expect(authModal).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('How Reputation Works link scrolls to section', async ({ page }) => {
      await page.getByRole('link', { name: /how reputation works/i }).click();
      
      // Check that the reputation section is now in view
      const reputationSection = page.locator('#how-reputation-works');
      await expect(reputationSection).toBeInViewport();
    });
  });
});
