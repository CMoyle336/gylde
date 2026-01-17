/**
 * Subscription tier types and interfaces
 */

export type SubscriptionTier = 'free' | 'plus' | 'elite';

export interface SubscriptionPlan {
  id: SubscriptionTier;
  name: string;
  tagline: string;
  monthlyPrice: number; // Monthly price in cents
  quarterlyPrice: number; // 3-month price in cents (total, not per month)
  features: SubscriptionFeature[];
  highlighted?: boolean; // For UI emphasis
  badge?: string; // Icon name for the tier
}

export interface SubscriptionFeature {
  id: string;
  label: string;
  included: boolean;
  highlight?: boolean; // Emphasize this feature
}

export interface UserSubscription {
  tier: SubscriptionTier;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodStart?: unknown;
  currentPeriodEnd?: unknown;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: unknown; // Firestore Timestamp - specific cancellation date
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  // Pending downgrade fields (for scheduled tier changes)
  pendingDowngradeTier?: SubscriptionTier | null;
  pendingDowngradeDate?: unknown; // Firestore Timestamp
}

/**
 * Feature flags based on subscription tier
 */
export interface SubscriptionCapabilities {
  canMessage: boolean;
  canVerifyProfile: boolean;
  hasAIAssistant: boolean;
  hasVirtualPhone: boolean;
  hasPriorityVisibility: boolean;
  canSeeWhoViewedProfile: boolean;
  maxPhotos: number;
  canAccessPrivatePhotos: boolean;
}

/**
 * Get capabilities for a given subscription tier
 */
export function getSubscriptionCapabilities(tier: SubscriptionTier): SubscriptionCapabilities {
  switch (tier) {
    case 'elite':
      return {
        canMessage: true,
        canVerifyProfile: true,
        hasAIAssistant: true,
        hasVirtualPhone: true,
        hasPriorityVisibility: true,
        canSeeWhoViewedProfile: true,
        maxPhotos: 10,
        canAccessPrivatePhotos: true,
      };
    case 'plus':
      return {
        canMessage: true,
        canVerifyProfile: true,
        hasAIAssistant: false,
        hasVirtualPhone: false,
        hasPriorityVisibility: false,
        canSeeWhoViewedProfile: true,
        maxPhotos: 8,
        canAccessPrivatePhotos: true,
      };
    case 'free':
    default:
      return {
        canMessage: false,
        canVerifyProfile: true, // Free users can verify their identity
        hasAIAssistant: false,
        hasVirtualPhone: false,
        hasPriorityVisibility: false,
        canSeeWhoViewedProfile: true,
        maxPhotos: 5,
        canAccessPrivatePhotos: false, // Only paid tiers can request/view private photos
      };
  }
}

/**
 * Subscription plans configuration
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Explorer',
    tagline: 'Browse and discover',
    monthlyPrice: 0,
    quarterlyPrice: 0,
    badge: 'explore',
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 5 photos', included: true },
      { id: 'views', label: 'See who viewed you', included: true },
      { id: 'verify', label: 'Verify your profile', included: true },
      { id: 'messaging', label: 'Send messages', included: false },
      { id: 'private-photos', label: 'Request & view private photos', included: false },
      { id: 'priority', label: 'Priority in search results', included: false, highlight: false },
      { id: 'ai', label: 'AI assistant', included: false },
      { id: 'phone', label: 'Virtual phone number', included: false },
    ],
  },
  {
    id: 'plus',
    name: 'Connect',
    tagline: 'Start meaningful conversations',
    monthlyPrice: 2999, // $29.99/month
    quarterlyPrice: 7497, // $74.97 for 3 months ($24.99/month)
    badge: 'chat_bubble',
    highlighted: true,
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 8 photos', included: true },
      { id: 'views', label: 'See who viewed you', included: true },
      { id: 'verify', label: 'Verify your profile', included: true },
      { id: 'messaging', label: 'Send unlimited messages', included: true, highlight: true },
      { id: 'private-photos', label: 'Request & view private photos', included: true, highlight: true },
      { id: 'priority', label: 'Priority in search results', included: false, highlight: false },
      { id: 'ai', label: 'AI assistant', included: false },
      { id: 'phone', label: 'Virtual phone number', included: false },
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    tagline: 'AI-powered dating experience',
    monthlyPrice: 7999, // $79.99/month
    quarterlyPrice: 17997, // $179.97 for 3 months ($59.99/month)
    badge: 'auto_awesome',
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 10 photos', included: true },
      { id: 'views', label: 'See who viewed you', included: true },
      { id: 'verify', label: 'Verify your profile', included: true },
      { id: 'messaging', label: 'Send unlimited messages', included: true },
      { id: 'private-photos', label: 'Request & view private photos', included: true },
      { id: 'priority', label: 'Priority in search results', included: true, highlight: true },
      { id: 'ai', label: 'AI assistant for profile & chat', included: true, highlight: true },
      { id: 'phone', label: 'Virtual phone number', included: true, highlight: true },
    ],
  },
];
