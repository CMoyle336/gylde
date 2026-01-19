import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RemoteConfig, fetchAndActivate, getValue, getBoolean, getNumber, getString } from '@angular/fire/remote-config';

/**
 * Remote Config keys and their types (client-side only)
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
  subscription_monthly_price_cents: 4999,
  premium_max_photos: 20,
  image_max_size_mb: 10,
  discover_page_size: 20,
  allowed_region_codes: ['us'],
};

/**
 * Service to manage Firebase Remote Config values
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
   * Initialize Remote Config - fetches and activates latest values
   */
  async initialize(): Promise<void> {
    // Remote Config only works in browser
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      // Set default values (client-side configs only)
      this.remoteConfig.defaultConfig = {
        virtual_phone_enabled: '',
        feature_report_issue: 'false',
        subscription_monthly_price_cents: '4999',
        premium_max_photos: '20',
        image_max_size_mb: '10',
        discover_page_size: '',
        allowed_region_codes: 'us',
      };

      // Fetch and activate
      await fetchAndActivate(this.remoteConfig);
      
      // Update signals with fetched values
      this.updateValues();
      this._initialized.set(true);
    } catch (error) {
      console.warn('Remote Config fetch failed, using defaults:', error);
      this._initialized.set(true);
    }
  }

  /**
   * Update all signal values from Remote Config
   */
  private updateValues(): void {
    // Boolean feature flags
    this._virtualPhoneEnabled.set(this.getBooleanValue('virtual_phone_enabled', DEFAULTS.virtual_phone_enabled));
    this._featureReportIssue.set(this.getBooleanValue('feature_report_issue', DEFAULTS.feature_report_issue));

    // Number values - empty string means use default
    this._subscriptionMonthlyPriceCents.set(this.getNumberValue('subscription_monthly_price_cents', DEFAULTS.subscription_monthly_price_cents));
    this._premiumMaxPhotos.set(this.getNumberValue('premium_max_photos', DEFAULTS.premium_max_photos));
    this._imageMaxSizeMb.set(this.getNumberValue('image_max_size_mb', DEFAULTS.image_max_size_mb));
    this._discoverPageSize.set(this.getNumberValue('discover_page_size', DEFAULTS.discover_page_size));
    
    // String array values
    this._allowedRegionCodes.set(this.getStringArrayValue('allowed_region_codes', DEFAULTS.allowed_region_codes));
  }

  /**
   * Get boolean value with fallback for empty strings
   */
  private getBooleanValue(key: string, defaultValue: boolean): boolean {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    return stringValue.toLowerCase() === 'true';
  }

  /**
   * Get number value with fallback for empty strings
   */
  private getNumberValue(key: string, defaultValue: number): number {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    const num = parseFloat(stringValue);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Get string array value (comma-separated) with fallback for empty strings
   */
  private getStringArrayValue(key: string, defaultValue: string[]): string[] {
    const stringValue = getString(this.remoteConfig, key);
    if (stringValue === '' || stringValue === undefined) {
      return defaultValue;
    }
    return stringValue.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Force refresh config values
   */
  async refresh(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await fetchAndActivate(this.remoteConfig);
      this.updateValues();
    } catch (error) {
      console.warn('Remote Config refresh failed:', error);
    }
  }
}
