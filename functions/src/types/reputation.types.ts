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

  // Founder status - grants special privileges
  isFounder?: boolean;
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
 */
export const FOUNDER_CONFIG = {
  // Maximum number of founders per region/city
  maxFoundersPerCity: 50,

  // Founders start at this tier
  startingTier: "trusted" as ReputationTier,

  // Founders cannot fall below this tier
  minimumTier: "active" as ReputationTier,
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
  maxPhotos: number;
}

/**
 * Reputation system configuration
 */
export const REPUTATION_CONFIG = {
  // Tier thresholds and limits
  tiers: {
    new: {
      minScore: 0,
      dailyHigherTierConversations: 1,
      canMessage: "all" as const, // Everyone can message everyone
      maxPhotos: 3,
    },
    active: {
      minScore: 200,
      dailyHigherTierConversations: 3,
      canMessage: "all" as const,
      maxPhotos: 5,
    },
    established: {
      minScore: 400,
      dailyHigherTierConversations: 5,
      canMessage: "all" as const,
      maxPhotos: 8,
    },
    trusted: {
      minScore: 600,
      dailyHigherTierConversations: 10,
      canMessage: "all" as const,
      maxPhotos: 12,
    },
    distinguished: {
      minScore: 800,
      dailyHigherTierConversations: -1, // Unlimited
      canMessage: "all" as const,
      maxPhotos: 15,
    },
  } as Record<ReputationTier, TierConfig>,

  // Signal weights for score calculation (must sum to 1.0)
  weights: {
    profileCompletion: 0.10, // 10%
    identityVerified: 0.20, // 20% - biggest factor
    accountAge: 0.10, // 10%
    responseRate: 0.15, // 15%
    blockRatio: 0.15, // 15% (inverted)
    reportRatio: 0.10, // 10% (inverted)
    conversationQuality: 0.10, // 10%
    ghostRate: 0.05, // 5% (inverted)
    burstScore: 0.05, // 5% (inverted)
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
    maxDaysForBonus: 365, // Full bonus at 1 year
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
 */
export function getDefaultSignals(): ReputationSignals {
  return {
    profileCompletion: 0,
    identityVerified: false,
    accountAgeDays: 0,
    responseRate: 0.5, // Neutral starting point
    conversationQuality: 0.5, // Neutral starting point
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
