/**
 * Subscription tier types and interfaces
 */

export type SubscriptionTier = 'free' | 'plus' | 'elite';

export interface SubscriptionPlan {
  id: SubscriptionTier;
  name: string;
  tagline: string;
  price: number; // Monthly price in cents
  yearlyPrice: number; // Yearly price in cents (for annual billing)
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

/**
 * Feature flags based on subscription tier
 */
export interface SubscriptionCapabilities {
  canMessage: boolean;
  canVerifyProfile: boolean;
  hasEliteTrustScore: boolean;
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
        hasEliteTrustScore: true,
        hasPriorityVisibility: true,
        canSeeWhoViewedProfile: true,
        maxPhotos: 10,
        canAccessPrivatePhotos: true,
      };
    case 'plus':
      return {
        canMessage: true,
        canVerifyProfile: true,
        hasEliteTrustScore: false,
        hasPriorityVisibility: false,
        canSeeWhoViewedProfile: true,
        maxPhotos: 8,
        canAccessPrivatePhotos: true,
      };
    case 'free':
    default:
      return {
        canMessage: false,
        canVerifyProfile: false,
        hasEliteTrustScore: false,
        hasPriorityVisibility: false,
        canSeeWhoViewedProfile: false,
        maxPhotos: 5,
        canAccessPrivatePhotos: false,
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
    price: 0,
    yearlyPrice: 0,
    badge: 'explore',
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 5 photos', included: true },
      { id: 'messaging', label: 'Send messages', included: false },
      { id: 'verify', label: 'Verify your profile', included: false },
      { id: 'views', label: 'See who viewed you', included: false },
      { id: 'priority', label: 'Priority visibility', included: false },
      { id: 'trust', label: 'Elite trust score', included: false },
    ],
  },
  {
    id: 'plus',
    name: 'Connect',
    tagline: 'Start meaningful conversations',
    price: 2999, // $29.99/month
    yearlyPrice: 23988, // $19.99/month billed annually
    badge: 'chat_bubble',
    highlighted: true,
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 8 photos', included: true },
      { id: 'messaging', label: 'Send unlimited messages', included: true, highlight: true },
      { id: 'verify', label: 'Verify your profile', included: true, highlight: true },
      { id: 'views', label: 'See who viewed you', included: true },
      { id: 'priority', label: 'Priority visibility', included: false },
      { id: 'trust', label: 'Elite trust score', included: false },
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    tagline: 'Maximum trust & visibility',
    price: 4999, // $49.99/month
    yearlyPrice: 35988, // $29.99/month billed annually
    badge: 'verified',
    features: [
      { id: 'browse', label: 'Browse unlimited profiles', included: true },
      { id: 'favorites', label: 'Save favorites', included: true },
      { id: 'photos', label: 'Upload up to 10 photos', included: true },
      { id: 'messaging', label: 'Send unlimited messages', included: true },
      { id: 'verify', label: 'Verify your profile', included: true },
      { id: 'views', label: 'See who viewed you', included: true },
      { id: 'priority', label: 'Priority in search results', included: true, highlight: true },
      { id: 'trust', label: 'Automatic 100% trust score', included: true, highlight: true },
    ],
  },
];
