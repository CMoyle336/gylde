import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type AxeFixture = {
  makeAxeBuilder: () => AxeBuilder;
};

/**
 * Extended test with pre-configured AxeBuilder for accessibility testing.
 * 
 * Configuration:
 * - Tests against WCAG 2.0 and 2.1 Level A and AA criteria
 * - Add any commonly excluded elements with known issues here
 */
export const test = base.extend<AxeFixture>({
  makeAxeBuilder: async ({ page }, use) => {
    const makeAxeBuilder = () => new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
      // Add common exclusions here if needed:
      // .exclude('#element-with-known-issue');

    await use(makeAxeBuilder);
  }
});

export { expect } from '@playwright/test';
