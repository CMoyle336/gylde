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
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
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
