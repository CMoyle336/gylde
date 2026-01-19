/**
 * Reputation System Interfaces
 *
 * The reputation system calculates user tiers based on behavioral signals.
 * Users see their tier and its effects, but never the underlying score.
 *
 * NOTE: Reputation data is stored in users/{uid}/private/data.reputation
 * and can only be written by Cloud Functions.
 */

/**
 * Reputation tier levels
 */
export type ReputationTier =
  | 'new'
  | 'active'
  | 'established'
  | 'trusted'
  | 'distinguished';

/**
 * All tiers in order from lowest to highest
 */
export const REPUTATION_TIER_ORDER: ReputationTier[] = [
  'new',
  'active',
  'established',
  'trusted',
  'distinguished',
];

/**
 * Reputation data as returned from the backend
 * Note: score is never included - it's internal only
 */
export interface ReputationData {
  tier: ReputationTier;
  /** Max new conversations per day with higher-tier users. -1 = unlimited */
  dailyHigherTierConversationLimit: number;
  /** Number of new conversations started with higher-tier users today */
  higherTierConversationsToday: number;
  lastCalculatedAt: unknown; // Firestore Timestamp
  tierChangedAt: unknown; // Firestore Timestamp
}

/**
 * Display information for a reputation tier
 */
export interface TierDisplay {
  label: string;
  description: string;
  icon: string;
  color: string;
  /** Whether this tier shows a public badge on profiles (new members have no badge) */
  showPublicBadge: boolean;
}

/**
 * UI display configuration for each tier
 * Note: "new" users get no public badge - the absence of a badge is neutral, not negative
 */
export const TIER_DISPLAY: Record<ReputationTier, TierDisplay> = {
  new: {
    label: 'New Member',
    description: 'Just getting started',
    icon: 'fiber_new',
    color: '#94a3b8', // slate-400
    showPublicBadge: false, // No badge shown publicly for new users
  },
  active: {
    label: 'Active',
    description: 'Engaged member',
    icon: 'trending_up',
    color: '#3b82f6', // blue-500
    showPublicBadge: true,
  },
  established: {
    label: 'Established',
    description: 'Long-standing member',
    icon: 'star_half',
    color: '#c9a962', // brand gold
    showPublicBadge: true,
  },
  trusted: {
    label: 'Trusted',
    description: 'Consistently respectful',
    icon: 'star',
    color: '#f59e0b', // amber-500
    showPublicBadge: true,
  },
  distinguished: {
    label: 'Distinguished',
    description: 'Exemplary community member',
    icon: 'workspace_premium',
    color: '#10b981', // emerald-500
    showPublicBadge: true,
  },
};

/**
 * Tier configuration for UI
 *
 * Messaging rules:
 * - Users can message anyone at same tier or below with no limits
 * - Users can START conversations with higher-tier users, limited per day
 * - Once a conversation exists, there are no limits on messages
 */
export interface TierConfig {
  minTier: ReputationTier;
  /** Max new conversations per day with HIGHER-tier users. -1 = unlimited */
  dailyHigherTierConversations: number;
  maxPhotos: number;
}

/**
 * Tier configuration matching backend
 */
export const TIER_CONFIG: Record<ReputationTier, TierConfig> = {
  new: {
    minTier: 'new',
    dailyHigherTierConversations: 1,
    maxPhotos: 3,
  },
  active: {
    minTier: 'active',
    dailyHigherTierConversations: 3,
    maxPhotos: 5,
  },
  established: {
    minTier: 'established',
    dailyHigherTierConversations: 5,
    maxPhotos: 8,
  },
  trusted: {
    minTier: 'trusted',
    dailyHigherTierConversations: 10,
    maxPhotos: 12,
  },
  distinguished: {
    minTier: 'distinguished',
    dailyHigherTierConversations: -1, // Unlimited
    maxPhotos: 15,
  },
};

/**
 * Premium subscribers get more photos regardless of reputation
 */
export const PREMIUM_MAX_PHOTOS = 20;

/**
 * Report reasons for the report user dialog
 */
export type ReportReason =
  | 'harassment'
  | 'spam'
  | 'fake_profile'
  | 'inappropriate_content'
  | 'solicitation'
  | 'other';

/**
 * Report reason display labels
 */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: 'Harassment or bullying',
  spam: 'Spam or scam',
  fake_profile: 'Fake or misleading profile',
  inappropriate_content: 'Inappropriate content',
  solicitation: 'Solicitation of services',
  other: 'Other',
};

/**
 * Request payload for reporting a user
 */
export interface ReportUserRequest {
  userId: string;
  reason: ReportReason;
  details?: string;
  conversationId?: string;
}

/**
 * Get tier display information
 */
export function getTierDisplay(tier: ReputationTier): TierDisplay {
  return TIER_DISPLAY[tier];
}

/**
 * Check if a tier should show a public badge
 * New users don't get a badge - absence of badge is neutral
 */
export function shouldShowPublicBadge(tier: ReputationTier): boolean {
  return TIER_DISPLAY[tier].showPublicBadge;
}

/**
 * Get tier configuration
 */
export function getTierConfig(tier: ReputationTier): TierConfig {
  return TIER_CONFIG[tier];
}

/**
 * Compare tiers (returns positive if tier1 > tier2)
 */
export function compareTiers(
  tier1: ReputationTier,
  tier2: ReputationTier
): number {
  return REPUTATION_TIER_ORDER.indexOf(tier1) - REPUTATION_TIER_ORDER.indexOf(tier2);
}

/**
 * Check if recipient tier is higher than sender tier
 */
export function isHigherTier(
  senderTier: ReputationTier,
  recipientTier: ReputationTier
): boolean {
  return compareTiers(recipientTier, senderTier) > 0;
}

/**
 * Get remaining higher-tier conversations for today
 */
export function getHigherTierConversationsRemaining(reputation: ReputationData): number {
  if (reputation.dailyHigherTierConversationLimit === -1) return -1; // Unlimited
  return Math.max(0, reputation.dailyHigherTierConversationLimit - reputation.higherTierConversationsToday);
}

/**
 * Check if user has reached daily higher-tier conversation limit
 */
export function hasReachedHigherTierLimit(reputation: ReputationData): boolean {
  if (reputation.dailyHigherTierConversationLimit === -1) return false; // Unlimited
  return reputation.higherTierConversationsToday >= reputation.dailyHigherTierConversationLimit;
}
