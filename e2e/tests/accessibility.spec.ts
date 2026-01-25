import { test, expect } from './fixtures/axe.fixture';
import { formatViolations } from './utils/a11y-helpers';

test.describe('Accessibility', () => {
  test.describe('Home Page', () => {
    test('should not have any WCAG A/AA violations', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      const results = await makeAxeBuilder().analyze();

      // Attach full results for debugging
      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      // Provide readable error message
      expect(results.violations, formatViolations(results)).toEqual([]);
    });

    test('hero section should be accessible', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      const results = await makeAxeBuilder()
        .include('.hero')
        .analyze();

      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      expect(results.violations, formatViolations(results)).toEqual([]);
    });

    test('navigation should be accessible', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      const results = await makeAxeBuilder()
        .include('header.public-header')
        .analyze();

      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      expect(results.violations, formatViolations(results)).toEqual([]);
    });

    test('footer should be accessible', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      const results = await makeAxeBuilder()
        .include('footer')
        .analyze();

      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      expect(results.violations, formatViolations(results)).toEqual([]);
    });
  });

  test.describe('Auth Modal', () => {
    test('login modal should be accessible when open', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      // Open the auth modal
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.locator('.modal-backdrop').waitFor();

      const results = await makeAxeBuilder()
        .include('.modal-backdrop')
        .analyze();

      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      expect(results.violations, formatViolations(results)).toEqual([]);
    });

    test('signup modal should be accessible when open', async ({ page, makeAxeBuilder }, testInfo) => {
      await page.goto('/');

      // Open the auth modal in signup mode
      await page.getByRole('button', { name: /get started/i }).click();
      await page.locator('.modal-backdrop').waitFor();

      const results = await makeAxeBuilder()
        .include('.modal-backdrop')
        .analyze();

      await testInfo.attach('accessibility-scan-results', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      expect(results.violations, formatViolations(results)).toEqual([]);
    });
  });

  test.describe('Public Pages', () => {
    const publicPages = [
      { name: 'About', path: '/about' },
      { name: 'How It Works', path: '/how-it-works' },
      { name: 'Privacy Policy', path: '/privacy' },
      { name: 'Terms of Service', path: '/terms' },
      { name: 'Community Guidelines', path: '/guidelines' },
      { name: 'Safety Tips', path: '/safety' },
    ];

    for (const { name, path } of publicPages) {
      test(`${name} page should not have WCAG violations`, async ({ page, makeAxeBuilder }, testInfo) => {
        await page.goto(path);

        const results = await makeAxeBuilder().analyze();

        await testInfo.attach('accessibility-scan-results', {
          body: JSON.stringify(results, null, 2),
          contentType: 'application/json',
        });

        expect(results.violations, formatViolations(results)).toEqual([]);
      });
    }
  });
});
