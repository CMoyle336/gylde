import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Base URL configuration:
 * - Local: http://localhost:4200 (default)
 * - Live/Preview: Set BASE_URL env var (e.g., BASE_URL=https://preview.gylde.com)
 */
const baseURL = process.env.BASE_URL || 'http://localhost:4200';
const isLiveEnv = baseURL.includes('gylde.com');

// Determine worker count:
// - CI: 1 worker (sequential for reliability)
// - Live env: 4 workers max (avoid Firebase Auth quota issues)
// - Local: undefined (use all CPUs)
const workers = undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : (isLiveEnv ? 1 : 0),
  workers,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  
  // Test timeout - increase for live environments (network latency)
  timeout: isLiveEnv ? 90000 : 30000,

  // Global setup/teardown: creates test users
  globalSetup: './global.setup.ts',
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

  /* Run local dev server when not in CI and not targeting a live environment */
  ...(process.env.CI || isLiveEnv ? {} : {
    webServer: {
      command: 'npm run start',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      cwd: '../app',
    },
  }),
});
