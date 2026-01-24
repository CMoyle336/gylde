import { defineConfig, devices } from '@playwright/test';

/**
 * Base URL configuration:
 * - Local: http://localhost:4200 (default)
 * - CI/Preview: Set via BASE_URL environment variable
 */
const baseURL = process.env.BASE_URL || 'http://localhost:4200';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  
  // Test timeout - tests just login now, so 30s is enough
  timeout: 30000,

  // Global setup: create and onboard all test users before tests run
  globalSetup: './global.setup.ts',
  
  // Global teardown: delete all test users after tests complete
  globalTeardown: './global.teardown.ts',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ============================================
    // Default project - runs ALL tests (public + authenticated)
    // ============================================
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // Cross-browser projects (public tests only)
    // ============================================
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/authenticated/**', '**/accessibility.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/authenticated/**', '**/accessibility.spec.ts'],
    },
  ],

  /* Run local dev server when not in CI */
  ...(process.env.CI ? {} : {
    webServer: {
      command: 'npm run start',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      cwd: '../app',
    },
  }),
});
