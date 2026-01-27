/**
 * Reputation Engine Types
 *
 * The reputation system calculates user tiers based on behavioral signals.
 * It uses a hybrid model:
 * - REAL-TIME: Identity verification, blocks, reports, burst messaging
 * - DAILY BATCH: Response rate, ghost rate, conversation quality, decay
 *
 * Score is internal (0-1000), never exposed to users.
 * Users only see their tier and its effects.
 */

import {Timestamp} from "firebase-admin/firestore";

/**
 * Reputation tier levels
 * These are displayed to users as status badges
 */
export type ReputationTier =
  | "new"
  | "active"
  | "established"
  | "trusted"
  | "distinguished";

/**
 * All tiers in order from lowest to highest
 */
export const REPUTATION_TIER_ORDER: ReputationTier[] = [
  "new",
  "active",
  "established",
  "trusted",
  "distinguished",
];

/**
 * Behavioral signals used to calculate reputation score
 */
export interface ReputationSignals {
  // From existing trust system
  profileCompletion: number; // 0-100

  // Verification status
  identityVerified: boolean;

  // Account maturity
  accountAgeDays: number;

  // Positive engagement signals
  responseRate: number; // 0-1 (messages replied / messages received)
  conversationQuality: number; // 0-1 (based on message length + back-and-forth)

  // Negative signals (lower is better)
  blockRatio: number; // 0-1 (blocks received / total interactions)
  reportRatio: number; // 0-1 (reports received / total interactions)
  ghostRate: number; // 0-1 (abandoned conversations / total started)
  burstScore: number; // 0-1 (spam-like behavior detected)
}

/**
 * Complete reputation data stored in users/{uid}/private/data.reputation
 */
export interface ReputationData {
  // Current tier (what users see)
  tier: ReputationTier;

  // Internal score (0-1000, never exposed)
  score: number;

  // Timestamps
  lastCalculatedAt: Timestamp;
  tierChangedAt: Timestamp;
  createdAt: Timestamp;

  // Derived limits based on tier
  /** Max new conversations per day with higher-tier users. -1 = unlimited */
  dailyHigherTierConversationLimit: number;

  // Signal snapshots (for debugging/auditing)
  signals: ReputationSignals;

  // Counters for daily reset
  /** Number of new conversations started with higher-tier users today */
  higherTierConversationsToday: number;
  lastConversationDate: string; // YYYY-MM-DD for reset detection
}

/**
 * Founder region tracking document
 * Stored in founders/{normalizedCity}
 */
export interface FounderRegion {
  // Normalized city name (lowercase, trimmed)
  city: string;

  // Display name of the city
  displayCity: string;

  // Current count of founders in this region
  count: number;

  // Maximum allowed founders (typically 50)
  maxFounders: number;

  // When the region reached capacity (if applicable)
  closedAt?: Timestamp;

  // When this region was first created
  createdAt: Timestamp;

  // Last updated timestamp
  updatedAt: Timestamp;
}

/**
 * Founder configuration constants
 * Note: Founders no longer get reputation bonuses - they are calculated
 * the same as regular users. This config is only for founder slot limits.
 */
export const FOUNDER_CONFIG = {
  // Maximum number of founders per region/city
  maxFoundersPerCity: 50,
} as const;

/**
 * Message metrics for calculating reputation signals
 * Stored in users/{uid}/private/data.messageMetrics
 */
export interface MessageMetrics {
  // Response tracking
  received: number; // Total messages received from others
  replied: number; // Messages we replied to

  // Conversation tracking
  conversationsStarted: number; // Conversations initiated by user
  conversationsWithReplies: number; // Conversations where other party replied

  // Quality metrics
  totalMessageLength: number; // Sum of all message lengths
  messageCount: number; // Total messages sent

  // Daily limit tracking (reset by scheduled job)
  sentToday: number;
  lastSentDate: string; // YYYY-MM-DD

  // Burst detection
  recentSendTimestamps: number[]; // Last N message timestamps (ms)

  // Ghost detection
  pendingResponses: number; // Messages received but not replied to
  lastReceivedAt: Timestamp | null;
}

/**
 * User report record
 * Stored in users/{uid}/reports/{reportId}
 */
export interface UserReport {
  // Who filed the report
  reportedByUserId: string;
  reportedByTier: ReputationTier;

  // Report details
  reason: ReportReason;
  details?: string;
  conversationId?: string; // Optional evidence link

  // Timestamps
  createdAt: Timestamp;

  // Moderation status
  status: ReportStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string; // Admin UID
  resolution?: string;
}

export type ReportReason =
  | "harassment"
  | "spam"
  | "fake_profile"
  | "inappropriate_content"
  | "solicitation"
  | "other";

export type ReportStatus =
  | "pending"
  | "reviewed"
  | "dismissed"
  | "action_taken";

/**
 * Tier configuration
 *
 * Messaging rules:
 * - Users can message anyone at same tier or below with no limits
 * - Users can START conversations with higher-tier users, limited per day
 * - Once a conversation exists, there are no limits on messages
 */
export interface TierConfig {
  minScore: number;
  /** Max new conversations per day with HIGHER-tier users. -1 = unlimited */
  dailyHigherTierConversations: number;
  /** Which tiers this tier can message (deprecated, now all tiers can message each other) */
  canMessage: ReputationTier[] | "all";
}

/**
 * Reputation system configuration
 *
 * Tier progression is designed so that:
 * - New users start at "New" tier and progress to "Active" after some activity
 * - Verification is a major boost but doesn't skip multiple tiers
 * - Distinguished requires sustained good behavior over time
 */
export const REPUTATION_CONFIG = {
  // Tier thresholds and limits (lowered for more gradual progression)
  tiers: {
    new: {
      minScore: 0,
      dailyHigherTierConversations: 1,
      canMessage: "all" as const,
    },
    active: {
      minScore: 150, // Lowered from 200
      dailyHigherTierConversations: 3,
      canMessage: "all" as const,
    },
    established: {
      minScore: 350, // Lowered from 400
      dailyHigherTierConversations: 5,
      canMessage: "all" as const,
    },
    trusted: {
      minScore: 550, // Lowered from 600
      dailyHigherTierConversations: 10,
      canMessage: "all" as const,
    },
    distinguished: {
      minScore: 750, // Lowered from 800
      dailyHigherTierConversations: -1, // Unlimited
      canMessage: "all" as const,
    },
  } as Record<ReputationTier, TierConfig>,

  // Signal weights for score calculation (must sum to 1.0)
  // Rebalanced to reward effort-based signals more, reduce "free" points from clean slate
  weights: {
    profileCompletion: 0.15, // 15% (up from 10%) - rewards profile effort
    identityVerified: 0.20, // 20% - major trust signal, unchanged
    accountAge: 0.15, // 15% (up from 10%) - rewards longevity
    responseRate: 0.15, // 15% - unchanged
    blockRatio: 0.10, // 10% (down from 15%) - still penalizes bad behavior
    reportRatio: 0.05, // 5% (down from 10%) - less weight on reports
    conversationQuality: 0.10, // 10% - unchanged
    ghostRate: 0.05, // 5% - unchanged
    burstScore: 0.05, // 5% - unchanged
  },

  // Decay and recovery rates
  decay: {
    dailyDecayRate: 0.02, // 2% daily decay for negative patterns
    maxDecay: 0.30, // Cap total decay at 30%
    recoveryRate: 0.01, // 1% daily recovery for good behavior
  },

  // Burst detection thresholds
  burst: {
    windowMs: 60000, // 1 minute window
    maxMessages: 5, // Max messages before flagged as burst
    penaltyDuration: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Account age thresholds
  accountAge: {
    maxDaysForBonus: 730, // Full bonus at 2 years (up from 1 year)
  },
} as const;

/**
 * Calculate tier from score
 */
export function scoreToTier(score: number): ReputationTier {
  const {tiers} = REPUTATION_CONFIG;

  if (score >= tiers.distinguished.minScore) return "distinguished";
  if (score >= tiers.trusted.minScore) return "trusted";
  if (score >= tiers.established.minScore) return "established";
  if (score >= tiers.active.minScore) return "active";
  return "new";
}

/**
 * Get tier configuration
 */
export function getTierConfig(tier: ReputationTier): TierConfig {
  return REPUTATION_CONFIG.tiers[tier];
}

/**
 * Check if a tier can message another tier
 */
export function canTierMessage(
  senderTier: ReputationTier,
  recipientTier: ReputationTier
): boolean {
  const config = getTierConfig(senderTier);
  if (config.canMessage === "all") return true;
  return config.canMessage.includes(recipientTier);
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
 * Default signals for new users
 * Note: responseRate and conversationQuality start at 0, not 0.5
 * Users must earn these through actual engagement
 */
export function getDefaultSignals(): ReputationSignals {
  return {
    profileCompletion: 0,
    identityVerified: false,
    accountAgeDays: 0,
    responseRate: 0, // Must earn through engagement (was 0.5)
    conversationQuality: 0, // Must earn through engagement (was 0.5)
    blockRatio: 0,
    reportRatio: 0,
    ghostRate: 0,
    burstScore: 0,
  };
}

/**
 * Default message metrics for new users
 */
export function getDefaultMessageMetrics(): MessageMetrics {
  return {
    received: 0,
    replied: 0,
    conversationsStarted: 0,
    conversationsWithReplies: 0,
    totalMessageLength: 0,
    messageCount: 0,
    sentToday: 0,
    lastSentDate: "",
    recentSendTimestamps: [],
    pendingResponses: 0,
    lastReceivedAt: null,
  };
}
