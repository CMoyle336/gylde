import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Analytics, logEvent, setUserId, setUserProperties } from '@angular/fire/analytics';
import { ReputationTier } from '../interfaces';
import { environment } from '../../../environments/environment';
import { BUILD_INFO } from '../../../environments/build-info';

/**
 * Analytics event categories for organized tracking
 */
export type AnalyticsCategory = 
  | 'authentication'
  | 'navigation'
  | 'discovery'
  | 'profile'
  | 'messaging'
  | 'matches'
  | 'favorites'
  | 'photos'
  | 'settings'
  | 'subscription'
  | 'onboarding'
  | 'engagement'
  | 'error';

/**
 * Standard event parameters that can be included with any event
 */
export interface AnalyticsEventParams {
  category?: AnalyticsCategory;
  label?: string;
  value?: number;
  [key: string]: unknown;
}

/**
 * User properties for analytics segmentation
 */
export interface AnalyticsUserProperties {
  subscription_tier?: 'free' | 'premium';
  reputation_tier?: ReputationTier;
  is_founder?: boolean;
  profile_complete?: boolean;
  has_photos?: boolean;
  photo_count?: number;
  account_age_days?: number;
  language?: string;
  theme?: 'light' | 'dark';
  // App/Firebase context (helps correlate users to environment/build)
  app_env?: string;
  app_build?: string;
  firebase_project_id?: string;
  firebase_app_id?: string;
}

/**
 * Comprehensive Analytics Service for tracking user behavior
 * 
 * This service wraps Firebase Analytics to provide:
 * - Type-safe event tracking
 * - User property management
 * - Session tracking
 * - Error logging
 * - SSR-safe operations
 */
@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly analytics = isPlatformBrowser(this.platformId) 
    ? inject(Analytics, { optional: true }) 
    : null;
  
  private sessionStartTime = Date.now();
  private currentPage: string | null = null;
  private contextLogged = false;

  private readonly contextUserProperties: AnalyticsUserProperties = (() => {
    const appEnv = (environment as unknown as { name?: string }).name
      || (environment.production ? 'production' : 'development');

    const props: AnalyticsUserProperties = {
      app_env: appEnv,
      app_build: BUILD_INFO?.buildId || BUILD_INFO?.gitSha || 'unknown',
      firebase_project_id: environment.firebase?.projectId,
      firebase_app_id: environment.firebase?.appId,
    };

    // Strip undefined/null so we don't create noisy user properties
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === '') {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (props as Record<string, unknown>)[key];
      }
    }

    return props;
  })();

  private readonly contextEventParams: Record<string, unknown> = (() => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.contextUserProperties)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return params;
  })();

  /**
   * Check if analytics is available (browser environment with Analytics initialized)
   */
  private get isAvailable(): boolean {
    return isPlatformBrowser(this.platformId) && !!this.analytics;
  }

  /**
   * Log a Firebase Analytics event without adding automatic enrichments.
   * Use this to avoid accidental recursion when emitting "context" events.
   */
  private logEventRaw(eventName: string, params?: Record<string, unknown>): void {
    if (!this.isAvailable) return;
    logEvent(this.analytics!, eventName, params);
  }

  // ============================================
  // USER IDENTIFICATION
  // ============================================

  /**
   * Set the user ID for analytics (call on login)
   */
  setUser(userId: string): void {
    if (!this.isAvailable) return;
    setUserId(this.analytics!, userId);
    // Ensure app/build/env context is associated with this user session
    this.trackAppContext();
  }

  /**
   * Clear user ID (call on logout)
   */
  clearUser(): void {
    if (!this.isAvailable) return;
    setUserId(this.analytics!, '');
  }

  /**
   * Set user properties for segmentation
   */
  setUserProperties(properties: AnalyticsUserProperties): void {
    if (!this.isAvailable) return;
    
    // Always include app/build/env context so other calls don't "forget" it.
    const merged: AnalyticsUserProperties = {
      ...this.contextUserProperties,
      ...properties,
    };

    // Convert to record with string values as required by Firebase
    const props: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== null) {
        props[key] = String(value);
      }
    }
    
    setUserProperties(this.analytics!, props);
  }

  // ============================================
  // CORE EVENT TRACKING
  // ============================================

  /**
   * Log a custom analytics event
   */
  logEvent(eventName: string, params?: AnalyticsEventParams): void {
    if (!this.isAvailable) return;
    
    // Add session duration to all events
    const enrichedParams = {
      ...this.contextEventParams,
      ...params,
      session_duration_ms: Date.now() - this.sessionStartTime,
    };
    
    logEvent(this.analytics!, eventName, enrichedParams);
  }

  // ============================================
  // AUTHENTICATION EVENTS
  // ============================================

  /**
   * Track app context (build/env/firebase ids) once per session.
   *
   * This makes it easy to find a user/session in GA4 and see exactly which
   * Firebase project/app + build they were using.
   */
  trackAppContext(): void {
    if (!this.isAvailable) return;
    if (this.contextLogged) return;

    this.contextLogged = true;
    this.setUserProperties({});

    this.logEventRaw('app_context', {
      category: 'engagement',
      ...this.contextEventParams,
    });
  }

  /**
   * Track app loaded event
   */
  trackAppLoaded(): void {
    this.trackAppContext();
    this.logEvent('app_loaded', { category: 'engagement' });
  }

  /**
   * Track user login
   */
  trackLogin(method: 'email' | 'google' | 'phone'): void {
    this.logEvent('login', { 
      category: 'authentication',
      method,
    });
  }

  /**
   * Track user signup
   */
  trackSignup(method: 'email' | 'google'): void {
    this.logEvent('sign_up', { 
      category: 'authentication',
      method,
    });
  }

  /**
   * Track user logout
   */
  trackLogout(): void {
    this.logEvent('logout', { category: 'authentication' });
    this.clearUser();
  }

  // ============================================
  // NAVIGATION EVENTS
  // ============================================

  /**
   * Track page view (enhanced beyond automatic screen tracking)
   */
  trackPageView(pageName: string, additionalParams?: Record<string, unknown>): void {
    this.currentPage = pageName;
    this.logEvent('page_view', {
      category: 'navigation',
      page_name: pageName,
      ...additionalParams,
    });
  }

  /**
   * Track navigation item click in shell
   */
  trackNavigation(destination: string, source?: string): void {
    this.logEvent('navigation', {
      category: 'navigation',
      destination,
      source: source || this.currentPage || 'unknown',
    });
  }

  // ============================================
  // DISCOVERY EVENTS
  // ============================================

  /**
   * Track discovery search/filter
   */
  trackDiscoverySearch(params: {
    filterCount: number;
    sortField?: string;
    sortDirection?: string;
    resultCount: number;
  }): void {
    this.logEvent('discovery_search', {
      category: 'discovery',
      filter_count: params.filterCount,
      sort_field: params.sortField,
      sort_direction: params.sortDirection,
      result_count: params.resultCount,
    });
  }

  /**
   * Track filter applied
   */
  trackFilterApplied(filterName: string, filterValue: unknown): void {
    this.logEvent('filter_applied', {
      category: 'discovery',
      filter_name: filterName,
      filter_value: String(filterValue),
    });
  }

  /**
   * Track sort changed
   */
  trackSortChanged(field: string, direction: string): void {
    this.logEvent('sort_changed', {
      category: 'discovery',
      sort_field: field,
      sort_direction: direction,
    });
  }

  /**
   * Track saved view applied
   */
  trackSavedViewApplied(viewName: string): void {
    this.logEvent('saved_view_applied', {
      category: 'discovery',
      view_name: viewName,
    });
  }

  /**
   * Track saved view created
   */
  trackSavedViewCreated(viewName: string, isDefault: boolean): void {
    this.logEvent('saved_view_created', {
      category: 'discovery',
      view_name: viewName,
      is_default: isDefault,
    });
  }

  /**
   * Track discovery load more (pagination)
   */
  trackLoadMore(page: number): void {
    this.logEvent('load_more', {
      category: 'discovery',
      page,
    });
  }

  // ============================================
  // PROFILE EVENTS
  // ============================================

  /**
   * Track viewing another user's profile
   */
  trackProfileView(viewedUserId: string, source: string): void {
    this.logEvent('profile_view', {
      category: 'profile',
      viewed_user_id: viewedUserId,
      source, // discover, matches, messages, activity, etc.
    });
  }

  /**
   * Track profile edit started
   */
  trackProfileEditStarted(): void {
    this.logEvent('profile_edit_started', { category: 'profile' });
  }

  /**
   * Track profile saved
   */
  trackProfileSaved(fieldsChanged: string[]): void {
    this.logEvent('profile_saved', {
      category: 'profile',
      fields_changed: fieldsChanged.join(','),
      fields_count: fieldsChanged.length,
    });
  }

  /**
   * Track photo uploaded
   */
  trackPhotoUploaded(photoCount: number, isProfilePhoto: boolean): void {
    this.logEvent('photo_uploaded', {
      category: 'photos',
      photo_count: photoCount,
      is_profile_photo: isProfilePhoto,
    });
  }

  /**
   * Track photo deleted
   */
  trackPhotoDeleted(): void {
    this.logEvent('photo_deleted', { category: 'photos' });
  }

  /**
   * Track profile photo changed
   */
  trackProfilePhotoChanged(): void {
    this.logEvent('profile_photo_changed', { category: 'photos' });
  }

  /**
   * Track photo privacy toggled
   */
  trackPhotoPrivacyToggled(isPrivate: boolean): void {
    this.logEvent('photo_privacy_toggled', {
      category: 'photos',
      is_private: isPrivate,
    });
  }

  /**
   * Track AI polish used (premium feature)
   */
  trackAiPolishUsed(field: string, applied: boolean): void {
    this.logEvent('ai_polish_used', {
      category: 'profile',
      field,
      applied,
    });
  }

  // ============================================
  // MESSAGING EVENTS
  // ============================================

  /**
   * Track conversation started
   */
  trackConversationStarted(source: string): void {
    this.logEvent('conversation_started', {
      category: 'messaging',
      source, // discover, matches, user_profile
    });
  }

  /**
   * Track message sent
   */
  trackMessageSent(hasMedia: boolean, messageLength: number): void {
    this.logEvent('message_sent', {
      category: 'messaging',
      has_media: hasMedia,
      message_length: messageLength,
    });
  }

  /**
   * Track conversation opened
   */
  trackConversationOpened(): void {
    this.logEvent('conversation_opened', { category: 'messaging' });
  }

  /**
   * Track virtual phone number viewed
   */
  trackVirtualPhoneViewed(): void {
    this.logEvent('virtual_phone_viewed', { category: 'messaging' });
  }

  // ============================================
  // MATCHES EVENTS
  // ============================================

  /**
   * Track matches tab changed
   */
  trackMatchesTabChanged(tab: string): void {
    this.logEvent('matches_tab_changed', {
      category: 'matches',
      tab,
    });
  }

  // ============================================
  // FAVORITES EVENTS
  // ============================================

  /**
   * Track favorite added
   */
  trackFavoriteAdded(source: string): void {
    this.logEvent('favorite_added', {
      category: 'favorites',
      source,
    });
  }

  /**
   * Track favorite removed
   */
  trackFavoriteRemoved(source: string): void {
    this.logEvent('favorite_removed', {
      category: 'favorites',
      source,
    });
  }

  // ============================================
  // PHOTO ACCESS EVENTS
  // ============================================

  /**
   * Track photo access requested
   */
  trackPhotoAccessRequested(): void {
    this.logEvent('photo_access_requested', { category: 'photos' });
  }

  /**
   * Track photo access granted
   */
  trackPhotoAccessGranted(): void {
    this.logEvent('photo_access_granted', { category: 'photos' });
  }

  /**
   * Track photo access denied
   */
  trackPhotoAccessDenied(): void {
    this.logEvent('photo_access_denied', { category: 'photos' });
  }

  // ============================================
  // SUBSCRIPTION & REVENUE EVENTS
  // ============================================

  /**
   * Track upgrade prompt shown
   */
  trackUpgradePromptShown(feature: string): void {
    this.logEvent('upgrade_prompt_shown', {
      category: 'subscription',
      feature,
    });
  }

  /**
   * Track upgrade started (clicked upgrade button)
   */
  trackUpgradeStarted(source: string): void {
    this.logEvent('upgrade_started', {
      category: 'subscription',
      source,
    });
  }

  /**
   * Track checkout initiated (redirect to Stripe)
   */
  trackCheckoutInitiated(params: {
    tier: string;
    priceInCents: number;
    currency?: string;
  }): void {
    this.logEvent('begin_checkout', {
      category: 'subscription',
      tier: params.tier,
      value: params.priceInCents / 100,
      currency: params.currency || 'USD',
    });
  }

  /**
   * Track subscription changed
   */
  trackSubscriptionChanged(newTier: string, previousTier: string): void {
    this.logEvent('subscription_changed', {
      category: 'subscription',
      new_tier: newTier,
      previous_tier: previousTier,
    });
  }

  // ============================================
  // REVENUE TRACKING (Firebase Analytics)
  // ============================================

  /**
   * Track a purchase/subscription for revenue attribution
   * 
   * This should be called when:
   * - User successfully subscribes to premium
   * - User makes a one-time purchase (e.g., identity verification)
   * - Subscription renews (if tracked client-side)
   */
  trackPurchase(params: {
    transactionId?: string;
    value: number;           // Revenue amount in dollars (e.g., 49.99)
    currency?: string;       // Currency code (default: USD)
    itemName: string;        // e.g., 'Premium Subscription', 'Identity Verification'
    itemId?: string;         // e.g., 'premium_monthly', 'id_verification'
    itemCategory?: string;   // e.g., 'subscription', 'one_time_purchase'
  }): void {
    if (!this.isAvailable) return;

    // Firebase Analytics 'purchase' event for revenue tracking
    logEvent(this.analytics!, 'purchase', {
      transaction_id: params.transactionId || `txn_${Date.now()}`,
      value: params.value,
      currency: params.currency || 'USD',
      items: [{
        item_id: params.itemId || params.itemName.toLowerCase().replace(/\s+/g, '_'),
        item_name: params.itemName,
        item_category: params.itemCategory || 'subscription',
        price: params.value,
        quantity: 1,
      }],
    });

    // Also log as custom event for additional tracking
    this.logEvent('revenue_event', {
      category: 'subscription',
      item_name: params.itemName,
      value: params.value,
      currency: params.currency || 'USD',
    });
  }

  /**
   * Track subscription start (first-time premium subscription)
   */
  trackSubscriptionStart(params: {
    subscriptionId?: string;
    tier: string;
    priceInCents: number;
    currency?: string;
    source?: string;
  }): void {
    const value = params.priceInCents / 100;
    
    // Track as purchase for revenue
    this.trackPurchase({
      transactionId: params.subscriptionId,
      value,
      currency: params.currency,
      itemName: `${params.tier.charAt(0).toUpperCase() + params.tier.slice(1)} Subscription`,
      itemId: `${params.tier}_monthly`,
      itemCategory: 'subscription',
    });

    // Additional subscription-specific event
    this.logEvent('subscription_start', {
      category: 'subscription',
      tier: params.tier,
      value,
      currency: params.currency || 'USD',
      source: params.source || 'unknown',
    });
  }

  /**
   * Track subscription renewal
   */
  trackSubscriptionRenewal(params: {
    subscriptionId?: string;
    tier: string;
    priceInCents: number;
    currency?: string;
  }): void {
    const value = params.priceInCents / 100;

    this.trackPurchase({
      transactionId: params.subscriptionId,
      value,
      currency: params.currency,
      itemName: `${params.tier.charAt(0).toUpperCase() + params.tier.slice(1)} Subscription Renewal`,
      itemId: `${params.tier}_monthly_renewal`,
      itemCategory: 'subscription_renewal',
    });

    this.logEvent('subscription_renewal', {
      category: 'subscription',
      tier: params.tier,
      value,
      currency: params.currency || 'USD',
    });
  }

  /**
   * Track subscription cancellation
   */
  trackSubscriptionCancelled(params: {
    tier: string;
    reason?: string;
  }): void {
    this.logEvent('subscription_cancelled', {
      category: 'subscription',
      tier: params.tier,
      reason: params.reason,
    });
  }

  /**
   * Track one-time purchase (e.g., identity verification)
   */
  trackOneTimePurchase(params: {
    transactionId?: string;
    itemName: string;
    priceInCents: number;
    currency?: string;
  }): void {
    this.trackPurchase({
      transactionId: params.transactionId,
      value: params.priceInCents / 100,
      currency: params.currency,
      itemName: params.itemName,
      itemId: params.itemName.toLowerCase().replace(/\s+/g, '_'),
      itemCategory: 'one_time_purchase',
    });
  }

  /**
   * Track refund
   */
  trackRefund(params: {
    transactionId: string;
    value: number;
    currency?: string;
    reason?: string;
  }): void {
    if (!this.isAvailable) return;

    // Firebase Analytics 'refund' event
    logEvent(this.analytics!, 'refund', {
      transaction_id: params.transactionId,
      value: params.value,
      currency: params.currency || 'USD',
    });

    this.logEvent('refund_processed', {
      category: 'subscription',
      transaction_id: params.transactionId,
      value: params.value,
      reason: params.reason,
    });
  }

  // ============================================
  // SETTINGS EVENTS
  // ============================================

  /**
   * Track setting changed
   */
  trackSettingChanged(category: string, setting: string, value: unknown): void {
    this.logEvent('setting_changed', {
      category: 'settings',
      setting_category: category,
      setting_name: setting,
      setting_value: String(value),
    });
  }

  /**
   * Track theme changed
   */
  trackThemeChanged(theme: 'light' | 'dark'): void {
    this.logEvent('theme_changed', {
      category: 'settings',
      theme,
    });
  }

  /**
   * Track language changed
   */
  trackLanguageChanged(language: string): void {
    this.logEvent('language_changed', {
      category: 'settings',
      language,
    });
  }

  /**
   * Track phone verification started
   */
  trackPhoneVerificationStarted(): void {
    this.logEvent('phone_verification_started', { category: 'settings' });
  }

  /**
   * Track phone verification completed
   */
  trackPhoneVerificationCompleted(success: boolean): void {
    this.logEvent('phone_verification_completed', {
      category: 'settings',
      success,
    });
  }

  /**
   * Track email verification sent
   */
  trackEmailVerificationSent(): void {
    this.logEvent('email_verification_sent', { category: 'settings' });
  }

  /**
   * Track account disabled
   */
  trackAccountDisabled(): void {
    this.logEvent('account_disabled', { category: 'settings' });
  }

  /**
   * Track account enabled
   */
  trackAccountEnabled(): void {
    this.logEvent('account_enabled', { category: 'settings' });
  }

  /**
   * Track account deleted
   */
  trackAccountDeleted(): void {
    this.logEvent('account_deleted', { category: 'settings' });
  }

  // ============================================
  // ONBOARDING EVENTS
  // ============================================

  /**
   * Track onboarding step completed
   */
  trackOnboardingStep(step: number, stepName: string): void {
    this.logEvent('onboarding_step', {
      category: 'onboarding',
      step,
      step_name: stepName,
    });
  }

  /**
   * Track onboarding completed
   */
  trackOnboardingCompleted(): void {
    this.logEvent('onboarding_completed', { category: 'onboarding' });
  }

  /**
   * Track onboarding abandoned
   */
  trackOnboardingAbandoned(lastStep: number): void {
    this.logEvent('onboarding_abandoned', {
      category: 'onboarding',
      last_step: lastStep,
    });
  }

  // ============================================
  // ENGAGEMENT EVENTS
  // ============================================

  /**
   * Track user blocked
   */
  trackUserBlocked(): void {
    this.logEvent('user_blocked', { category: 'engagement' });
  }

  /**
   * Track user unblocked
   */
  trackUserUnblocked(): void {
    this.logEvent('user_unblocked', { category: 'engagement' });
  }

  /**
   * Track user reported
   */
  trackUserReported(reason: string): void {
    this.logEvent('user_reported', {
      category: 'engagement',
      reason,
    });
  }

  /**
   * Track activity clicked
   */
  trackActivityClicked(activityType: string): void {
    this.logEvent('activity_clicked', {
      category: 'engagement',
      activity_type: activityType,
    });
  }

  /**
   * Track dialog opened
   */
  trackDialogOpened(dialogName: string): void {
    this.logEvent('dialog_opened', {
      category: 'engagement',
      dialog_name: dialogName,
    });
  }

  /**
   * Track feature used
   */
  trackFeatureUsed(featureName: string, details?: Record<string, unknown>): void {
    this.logEvent('feature_used', {
      category: 'engagement',
      feature_name: featureName,
      ...details,
    });
  }

  // ============================================
  // ERROR TRACKING
  // ============================================

  /**
   * Track error occurred
   */
  trackError(errorType: string, errorMessage: string, context?: string): void {
    this.logEvent('error_occurred', {
      category: 'error',
      error_type: errorType,
      error_message: errorMessage.substring(0, 100), // Truncate long messages
      context: context || this.currentPage || 'unknown',
    });
  }

  // ============================================
  // TIMING EVENTS
  // ============================================

  /**
   * Track timing (how long something took)
   */
  trackTiming(name: string, durationMs: number, category?: string): void {
    this.logEvent('timing', {
      category: category as AnalyticsCategory || 'engagement',
      timing_name: name,
      duration_ms: durationMs,
    });
  }

  /**
   * Start a timer and return a function to stop it
   */
  startTimer(name: string, category?: string): () => void {
    const startTime = Date.now();
    return () => {
      this.trackTiming(name, Date.now() - startTime, category);
    };
  }
}
