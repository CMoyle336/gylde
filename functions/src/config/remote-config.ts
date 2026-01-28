/**
 * Firebase Remote Config for Cloud Functions
 *
 * Provides type-safe access to Remote Config values with caching.
 * Values are fetched and cached, then refreshed periodically.
 */

import {getRemoteConfig} from "firebase-admin/remote-config";
import * as logger from "firebase-functions/logger";

/**
 * Remote Config values interface
 */
export interface RemoteConfigValues {
  virtual_phone_enabled: boolean;
  subscription_monthly_price_cents: number;
  founder_max_per_city: number;
  premium_max_photos: number;
  image_max_size_mb: number;
  reputation_decay_daily_rate: number;
  reputation_burst_max_messages: number;
  discover_page_size: number;
}

/**
 * Default values - used when Remote Config value is empty or unavailable
 */
const DEFAULTS: RemoteConfigValues = {
  virtual_phone_enabled: false,
  subscription_monthly_price_cents: 2499,
  founder_max_per_city: 50,
  premium_max_photos: 20,
  image_max_size_mb: 10,
  reputation_decay_daily_rate: 0.02,
  reputation_burst_max_messages: 5,
  discover_page_size: 20,
};

// Cache for config values
let cachedConfig: RemoteConfigValues | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

/**
 * Fetch Remote Config values from Firebase
 */
async function fetchConfig(): Promise<RemoteConfigValues> {
  try {
    const remoteConfig = getRemoteConfig();
    const template = await remoteConfig.getServerTemplate();
    const config = template.evaluate();

    return {
      virtual_phone_enabled: parseBooleanValue(
        config.getString("virtual_phone_enabled"),
        DEFAULTS.virtual_phone_enabled
      ),
      subscription_monthly_price_cents: parseNumberValue(
        config.getString("subscription_monthly_price_cents"),
        DEFAULTS.subscription_monthly_price_cents
      ),
      founder_max_per_city: parseNumberValue(
        config.getString("founder_max_per_city"),
        DEFAULTS.founder_max_per_city
      ),
      premium_max_photos: parseNumberValue(
        config.getString("premium_max_photos"),
        DEFAULTS.premium_max_photos
      ),
      image_max_size_mb: parseNumberValue(
        config.getString("image_max_size_mb"),
        DEFAULTS.image_max_size_mb
      ),
      reputation_decay_daily_rate: parseNumberValue(
        config.getString("reputation_decay_daily_rate"),
        DEFAULTS.reputation_decay_daily_rate
      ),
      reputation_burst_max_messages: parseNumberValue(
        config.getString("reputation_burst_max_messages"),
        DEFAULTS.reputation_burst_max_messages
      ),
      discover_page_size: parseNumberValue(
        config.getString("discover_page_size"),
        DEFAULTS.discover_page_size
      ),
    };
  } catch (error) {
    logger.warn("Failed to fetch Remote Config, using defaults:", error);
    return DEFAULTS;
  }
}

/**
 * Parse boolean value with fallback for empty strings
 */
function parseBooleanValue(value: string, defaultValue: boolean): boolean {
  if (!value || value === "") {
    return defaultValue;
  }
  return value.toLowerCase() === "true";
}

/**
 * Parse number value with fallback for empty strings
 */
function parseNumberValue(value: string, defaultValue: number): number {
  if (!value || value === "") {
    return defaultValue;
  }
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Get Remote Config values with caching
 *
 * @returns Promise resolving to config values
 */
export async function getConfig(): Promise<RemoteConfigValues> {
  const now = Date.now();

  // Return cached values if still valid
  if (cachedConfig && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  // Fetch fresh values
  cachedConfig = await fetchConfig();
  lastFetchTime = now;

  return cachedConfig;
}

/**
 * Get a specific config value
 *
 * @param key - The config key to get
 * @returns Promise resolving to the config value
 */
export async function getConfigValue<K extends keyof RemoteConfigValues>(
  key: K
): Promise<RemoteConfigValues[K]> {
  const config = await getConfig();
  return config[key];
}

/**
 * Force refresh the cached config
 */
export async function refreshConfig(): Promise<RemoteConfigValues> {
  cachedConfig = await fetchConfig();
  lastFetchTime = Date.now();
  return cachedConfig;
}

/**
 * Get default values (synchronous, no network)
 * Use this when you can't await or need immediate values
 */
export function getDefaults(): RemoteConfigValues {
  return {...DEFAULTS};
}

/**
 * Get cached config synchronously (returns defaults if not cached)
 * Use this for hot paths where async is not acceptable
 */
export function getCachedConfig(): RemoteConfigValues {
  return cachedConfig || DEFAULTS;
}
