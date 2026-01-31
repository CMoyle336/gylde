import { Injectable, inject, signal, PLATFORM_ID, makeStateKey, TransferState } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { RemoteConfig, fetchAndActivate, getString } from '@angular/fire/remote-config';

/**
 * Remote Config keys and their types
 * 
 * Note: Server-only configs (reputation_*, founder_max_per_city) are not
 * included here as they should not be exposed to clients.
 */
export interface RemoteConfigValues {
  // Feature flags
  virtual_phone_enabled: boolean;
  feature_report_issue: boolean;
  
  // Pricing & limits (display purposes - server enforces actual limits)
  subscription_monthly_price_cents: number;
  premium_max_photos: number;
  image_max_size_mb: number;
  discover_page_size: number;
  
  // Geographic restrictions
  allowed_region_codes: string[];
}

/**
 * Default values - used when Remote Config hasn't loaded or value is empty
 */
const DEFAULTS: RemoteConfigValues = {
  virtual_phone_enabled: false,
  feature_report_issue: false,
  subscription_monthly_price_cents: 2499,
  premium_max_photos: 20,
  image_max_size_mb: 10,
  discover_page_size: 20,
  allowed_region_codes: ['us'],
};

// TransferState key for passing config from server to client
const REMOTE_CONFIG_KEY = makeStateKey<RemoteConfigValues>('remoteConfig');
const REMOTE_CONFIG_INITIALIZED_KEY = makeStateKey<boolean>('remoteConfigInitialized');

/**
 * Service to manage Firebase Remote Config values
 * 
 * On SSR: Fetches config using Firebase Admin SDK and stores in TransferState
 * On Client: Reads from TransferState if available, otherwise fetches via client SDK
 * 
 * Usage:
 * ```typescript
 * private readonly remoteConfig = inject(RemoteConfigService);
 * 
 * // Get values (reactive signals)
 * const price = this.remoteConfig.subscriptionMonthlyPriceCents();
 * const isVirtualPhoneEnabled = this.remoteConfig.virtualPhoneEnabled();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class RemoteConfigService {
  private readonly remoteConfig = inject(RemoteConfig);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);

  // Signals for reactive config values
  private readonly _initialized = signal(false);
  private readonly _virtualPhoneEnabled = signal(DEFAULTS.virtual_phone_enabled);
  private readonly _featureReportIssue = signal(DEFAULTS.feature_report_issue);
  private readonly _subscriptionMonthlyPriceCents = signal(DEFAULTS.subscription_monthly_price_cents);
  private readonly _premiumMaxPhotos = signal(DEFAULTS.premium_max_photos);
  private readonly _imageMaxSizeMb = signal(DEFAULTS.image_max_size_mb);
  private readonly _discoverPageSize = signal(DEFAULTS.discover_page_size);
  private readonly _allowedRegionCodes = signal(DEFAULTS.allowed_region_codes);

  // Public readonly signals
  readonly initialized = this._initialized.asReadonly();
  readonly virtualPhoneEnabled = this._virtualPhoneEnabled.asReadonly();
  readonly featureReportIssue = this._featureReportIssue.asReadonly();
  readonly subscriptionMonthlyPriceCents = this._subscriptionMonthlyPriceCents.asReadonly();
  readonly premiumMaxPhotos = this._premiumMaxPhotos.asReadonly();
  readonly imageMaxSizeMb = this._imageMaxSizeMb.asReadonly();
  readonly discoverPageSize = this._discoverPageSize.asReadonly();
  readonly allowedRegionCodes = this._allowedRegionCodes.asReadonly();

  constructor() {
    this.initialize();
  }

  /**
   * Initialize Remote Config
   * - On server: Fetch via Admin SDK and store in TransferState
   * - On client: Read from TransferState if available, otherwise fetch via client SDK
   */
  async initialize(): Promise<void> {
    if (isPlatformServer(this.platformId)) {
      await this.initializeServer();
    } else if (isPlatformBrowser(this.platformId)) {
      await this.initializeBrowser();
    }
  }

  /**
   * Server-side initialization using Firebase Admin SDK
   */
  private async initializeServer(): Promise<void> {
    // Check if we have credentials available (required for Remote Config)
    // In development, we typically don't have credentials, so skip gracefully
    const hasCredentials = !!(
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] ||
      process.env['FIREBASE_CONFIG'] ||
      process.env['GCLOUD_PROJECT'] ||
      process.env['K_SERVICE'] // Cloud Run/Cloud Functions
    );

    if (!hasCredentials) {
      // No credentials available - use defaults silently in development
      this.transferState.set(REMOTE_CONFIG_KEY, DEFAULTS);
      this.transferState.set(REMOTE_CONFIG_INITIALIZED_KEY, true);
      this._initialized.set(true);
      return;
    }

    try {
      // Dynamic import firebase-admin (only available on server)
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default || adminModule;
      const { getRemoteConfig } = await import('firebase-admin/remote-config');
      
      // Initialize admin if not already initialized
      // Check both admin.apps and admin.apps?.length for safety
      const apps = admin.apps;
      if (!apps || apps.length === 0) {
        admin.initializeApp();
      }

      const remoteConfig = getRemoteConfig();
      const template = await remoteConfig.getServerTemplate();
      const config = template.evaluate();

      const values: RemoteConfigValues = {
        virtual_phone_enabled: this.parseBoolean(config.getString('virtual_phone_enabled'), DEFAULTS.virtual_phone_enabled),
        feature_report_issue: this.parseBoolean(config.getString('feature_report_issue'), DEFAULTS.feature_report_issue),
        subscription_monthly_price_cents: this.parseNumber(config.getString('subscription_monthly_price_cents'), DEFAULTS.subscription_monthly_price_cents),
        premium_max_photos: this.parseNumber(config.getString('premium_max_photos'), DEFAULTS.premium_max_photos),
        image_max_size_mb: this.parseNumber(config.getString('image_max_size_mb'), DEFAULTS.image_max_size_mb),
        discover_page_size: this.parseNumber(config.getString('discover_page_size'), DEFAULTS.discover_page_size),
        allowed_region_codes: this.parseStringArray(config.getString('allowed_region_codes'), DEFAULTS.allowed_region_codes),
      };

      // Store in TransferState for client
      this.transferState.set(REMOTE_CONFIG_KEY, values);
      this.transferState.set(REMOTE_CONFIG_INITIALIZED_KEY, true);

      // Update signals
      this.applyValues(values);
      this._initialized.set(true);
    } catch (error) {
      console.warn('Server Remote Config fetch failed, using defaults:', error);
      this.transferState.set(REMOTE_CONFIG_KEY, DEFAULTS);
      this.transferState.set(REMOTE_CONFIG_INITIALIZED_KEY, true);
      this._initialized.set(true);
    }
  }

  /**
   * Browser-side initialization
   * Reads from TransferState if available, otherwise fetches via client SDK
   */
  private async initializeBrowser(): Promise<void> {
    // Check for e2e test override (set by Playwright's addInitScript)
    const testOverride = (window as any).__remoteConfigOverride as RemoteConfigValues | undefined;
    if (testOverride) {
      console.log('[RemoteConfig] Using test override values');
      this.applyValues({ ...DEFAULTS, ...testOverride });
      this._initialized.set(true);
      return;
    }

    // Check if we have values from SSR
    if (this.transferState.hasKey(REMOTE_CONFIG_KEY)) {
      const values = this.transferState.get(REMOTE_CONFIG_KEY, DEFAULTS);
      this.applyValues(values);
      this._initialized.set(true);
      
      // Remove from TransferState so subsequent navigations don't reuse stale values
      this.transferState.remove(REMOTE_CONFIG_KEY);
      this.transferState.remove(REMOTE_CONFIG_INITIALIZED_KEY);
      
      // Optionally refresh in background for long-lived sessions
      // this.refreshInBackground();
      return;
    }

    // No SSR values, fetch via client SDK
    try {
      this.remoteConfig.defaultConfig = {
        virtual_phone_enabled: '',
        feature_report_issue: 'false',
        subscription_monthly_price_cents: '2499',
        premium_max_photos: '20',
        image_max_size_mb: '10',
        discover_page_size: '',
        allowed_region_codes: 'us',
      };

      await fetchAndActivate(this.remoteConfig);
      this.updateValuesFromClientSdk();
      this._initialized.set(true);
    } catch (error) {
      console.warn('Remote Config fetch failed, using defaults:', error);
      this._initialized.set(true);
    }
  }

  /**
   * Apply values to signals
   */
  private applyValues(values: RemoteConfigValues): void {
    this._virtualPhoneEnabled.set(values.virtual_phone_enabled);
    this._featureReportIssue.set(values.feature_report_issue);
    this._subscriptionMonthlyPriceCents.set(values.subscription_monthly_price_cents);
    this._premiumMaxPhotos.set(values.premium_max_photos);
    this._imageMaxSizeMb.set(values.image_max_size_mb);
    this._discoverPageSize.set(values.discover_page_size);
    this._allowedRegionCodes.set(values.allowed_region_codes);
  }

  /**
   * Update signals from client SDK values
   */
  private updateValuesFromClientSdk(): void {
    this._virtualPhoneEnabled.set(this.getBooleanValue('virtual_phone_enabled', DEFAULTS.virtual_phone_enabled));
    this._featureReportIssue.set(this.getBooleanValue('feature_report_issue', DEFAULTS.feature_report_issue));
    this._subscriptionMonthlyPriceCents.set(this.getNumberValue('subscription_monthly_price_cents', DEFAULTS.subscription_monthly_price_cents));
    this._premiumMaxPhotos.set(this.getNumberValue('premium_max_photos', DEFAULTS.premium_max_photos));
    this._imageMaxSizeMb.set(this.getNumberValue('image_max_size_mb', DEFAULTS.image_max_size_mb));
    this._discoverPageSize.set(this.getNumberValue('discover_page_size', DEFAULTS.discover_page_size));
    this._allowedRegionCodes.set(this.getStringArrayValue('allowed_region_codes', DEFAULTS.allowed_region_codes));
  }

  // === Parse helpers for server-side (plain strings) ===

  private parseBoolean(value: string, defaultValue: boolean): boolean {
    if (!value || value === '') return defaultValue;
    return value.toLowerCase() === 'true';
  }

  private parseNumber(value: string, defaultValue: number): number {
    if (!value || value === '') return defaultValue;
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
  }

  private parseStringArray(value: string, defaultValue: string[]): string[] {
    if (!value || value === '') return defaultValue;
    return value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  // === Get helpers for client SDK ===

  private getBooleanValue(key: string, defaultValue: boolean): boolean {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    return stringValue.toLowerCase() === 'true';
  }

  private getNumberValue(key: string, defaultValue: number): number {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    const num = parseFloat(stringValue);
    return isNaN(num) ? defaultValue : num;
  }

  private getStringArrayValue(key: string, defaultValue: string[]): string[] {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    return stringValue.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Force refresh config values (browser only)
   */
  async refresh(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await fetchAndActivate(this.remoteConfig);
      this.updateValuesFromClientSdk();
    } catch (error) {
      console.warn('Remote Config refresh failed:', error);
    }
  }
}
