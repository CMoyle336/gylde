import { test as base, Page } from '@playwright/test';

/**
 * Remote Config values that can be mocked in e2e tests
 * These match the RemoteConfigValues interface in the app
 */
export interface MockRemoteConfigValues {
  virtual_phone_enabled?: boolean;
  feature_report_issue?: boolean;
  feature_feed_enabled?: boolean;
  subscription_monthly_price_cents?: number;
  premium_max_photos?: number;
  image_max_size_mb?: number;
  discover_page_size?: number;
  allowed_region_codes?: string[];
}

/**
 * Default values matching the app's DEFAULTS
 */
export const REMOTE_CONFIG_DEFAULTS: Required<MockRemoteConfigValues> = {
  virtual_phone_enabled: false,
  feature_report_issue: false,
  feature_feed_enabled: true,
  subscription_monthly_price_cents: 2499,
  premium_max_photos: 20,
  image_max_size_mb: 10,
  discover_page_size: 20,
  allowed_region_codes: ['us'],
};

/**
 * Convert our mock values to Firebase Remote Config API response format
 */
function buildRemoteConfigResponse(values: MockRemoteConfigValues): object {
  const mergedValues = { ...REMOTE_CONFIG_DEFAULTS, ...values };
  
  // Firebase Remote Config returns values in this format
  const entries: Record<string, { stringValue: string }> = {};
  
  for (const [key, value] of Object.entries(mergedValues)) {
    let stringValue: string;
    if (Array.isArray(value)) {
      stringValue = value.join(',');
    } else if (typeof value === 'boolean') {
      stringValue = value.toString();
    } else {
      stringValue = String(value);
    }
    entries[key] = { stringValue };
  }

  return {
    state: 'UPDATE',
    entries,
    // Include a template version to make it look authentic
    templateVersion: '1',
  };
}

/**
 * Set up Remote Config mocking for a page
 * 
 * @param page - Playwright page
 * @param values - Config values to mock (merged with defaults)
 * 
 * @example
 * ```ts
 * // Disable feed feature
 * await mockRemoteConfig(page, { feature_feed_enabled: false });
 * 
 * // Test with virtual phone enabled
 * await mockRemoteConfig(page, { virtual_phone_enabled: true });
 * 
 * // Test geographic restrictions
 * await mockRemoteConfig(page, { allowed_region_codes: ['us', 'ca', 'gb'] });
 * ```
 */
export async function mockRemoteConfig(page: Page, values: MockRemoteConfigValues): Promise<void> {
  const response = buildRemoteConfigResponse(values);

  // Intercept Firebase Remote Config fetch requests
  // The SDK fetches from: https://firebaseremoteconfig.googleapis.com/v1/projects/{project}/namespaces/firebase:fetch
  await page.route('**/firebaseremoteconfig.googleapis.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Also intercept any SSR-injected TransferState by injecting a script that overrides it
  // This handles the case where config is passed from server via TransferState
  await page.addInitScript((configValues) => {
    // Override window.__remoteConfigOverride for the app to detect
    (window as any).__remoteConfigOverride = configValues;
  }, { ...REMOTE_CONFIG_DEFAULTS, ...values });
}

/**
 * Clear Remote Config mocking
 */
export async function clearRemoteConfigMock(page: Page): Promise<void> {
  await page.unroute('**/firebaseremoteconfig.googleapis.com/**');
}

/**
 * Extended test with Remote Config mocking helpers
 */
export const test = base.extend<{
  /**
   * Mock Remote Config values for this test
   * Call before navigating to pages that use Remote Config
   */
  mockRemoteConfig: (values: MockRemoteConfigValues) => Promise<void>;
  
  /**
   * Clear Remote Config mocking
   */
  clearRemoteConfigMock: () => Promise<void>;
}>({
  mockRemoteConfig: async ({ page }, use) => {
    await use(async (values: MockRemoteConfigValues) => {
      await mockRemoteConfig(page, values);
    });
  },

  clearRemoteConfigMock: async ({ page }, use) => {
    await use(async () => {
      await clearRemoteConfigMock(page);
    });
  },
});

export { expect } from '@playwright/test';
