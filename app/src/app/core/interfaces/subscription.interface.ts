/**
 * Subscription tier types and interfaces
 * Simplified to free/premium model
 */

export type SubscriptionTier = 'free' | 'premium';

export interface UserSubscription {
  tier: SubscriptionTier;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodStart?: unknown;
  currentPeriodEnd?: unknown;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: unknown; // Firestore Timestamp - specific cancellation date
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

/**
 * Feature flags based on subscription tier
 */
export interface SubscriptionCapabilities {
  // Messaging
  unlimitedMessaging: boolean;
  canMessageAnyTier: boolean;
  
  // Discovery & Visibility
  advancedFilters: boolean;
  priorityVisibility: boolean;
  
  // Photos
  maxPhotos: number;
  canAccessPrivatePhotos: boolean;
  
  // Activity
  canSeeWhoViewedProfile: boolean;
  canSeeWhoFavorited: boolean;
  
  // Premium features
  hasAIAssistant: boolean;
  hasVirtualPhone: boolean;
  readReceipts: boolean;
  
  // Identity verification is separate ($4.99 purchase)
}

/**
 * Get capabilities for a given subscription tier
 */
export function getSubscriptionCapabilities(tier: SubscriptionTier): SubscriptionCapabilities {
  switch (tier) {
    case 'premium':
      return {
        // Messaging
        unlimitedMessaging: true,
        canMessageAnyTier: true,
        
        // Discovery & Visibility
        advancedFilters: true,
        priorityVisibility: true,
        
        // Photos
        maxPhotos: 20,
        canAccessPrivatePhotos: true,
        
        // Activity
        canSeeWhoViewedProfile: true,
        canSeeWhoFavorited: true,
        
        // Premium features
        hasAIAssistant: true,
        hasVirtualPhone: true,
        readReceipts: true,
      };
    case 'free':
    default:
      return {
        // Messaging - reputation-based limits apply
        unlimitedMessaging: false,
        canMessageAnyTier: false,
        
        // Discovery & Visibility
        advancedFilters: false,
        priorityVisibility: false,
        
        // Photos
        maxPhotos: 5,
        canAccessPrivatePhotos: false,
        
        // Activity
        canSeeWhoViewedProfile: false,
        canSeeWhoFavorited: false,
        
        // Premium features
        hasAIAssistant: false,
        hasVirtualPhone: false,
        readReceipts: false,
      };
  }
}

/**
 * Subscription pricing configuration
 */
export const SUBSCRIPTION_PRICE = {
  monthly: 4999, // $49.99/month in cents
  name: 'Premium',
  tagline: 'Unlock the full Gylde experience',
  badge: 'star',
} as const;

/**
 * Premium features list for display
 */
export const PREMIUM_FEATURES = [
  { id: 'private-photos', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.PRIVATE_PHOTOS', icon: 'lock_open' },
  { id: 'advanced-filters', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.ADVANCED_FILTERS', icon: 'tune' },
  { id: 'who-viewed', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.WHO_VIEWED', icon: 'visibility' },
  { id: 'who-favorited', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.WHO_FAVORITED', icon: 'favorite' },
  { id: 'ai', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.AI', icon: 'auto_awesome' },
  { id: 'phone', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.PHONE', icon: 'phone_android' },
  { id: 'read-receipts', labelKey: 'UPGRADE_DIALOG.PREMIUM_FEATURES.READ_RECEIPTS', icon: 'done_all' },
] as const;
