/**
 * Test user definitions for e2e tests
 * These users are created during auth setup and represent different user types
 */

/**
 * Reputation tier levels (matches backend types)
 * Order from lowest to highest: new -> active -> established -> trusted -> distinguished
 */
export type ReputationTier = 'new' | 'active' | 'established' | 'trusted' | 'distinguished';

/**
 * Messaging limits by tier (for starting NEW conversations with HIGHER tier users):
 * - new: 1/day
 * - active: 3/day
 * - established: 5/day
 * - trusted: 10/day
 * - distinguished: unlimited (-1)
 */
export const TIER_MESSAGING_LIMITS: Record<ReputationTier, number> = {
  new: 1,
  active: 3,
  established: 5,
  trusted: 10,
  distinguished: -1, // unlimited
};

/**
 * Tier order for comparison (index = rank, higher = better)
 */
export const TIER_ORDER: ReputationTier[] = ['new', 'active', 'established', 'trusted', 'distinguished'];

export interface TestUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
  storageStatePath: string;
  // Onboarding data
  birthDate: Date;
  city: string;
  gender: 'man' | 'woman' | 'nonbinary';
  interestedIn: ('men' | 'women' | 'nonbinary')[];
  tagline: string;
  // Profile properties (set after user creation)
  isPremium?: boolean;
  isVerified?: boolean;
  reputationTier?: ReputationTier;
  testImage: string; // Which test image to use
  hasPrivateContent?: boolean; // If true, user will have private photos set up
}

// Helper to create a date for a specific age
function ageToDate(age: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - age);
  return date;
}

/**
 * Primary test users - used for main test flows
 * Note: emails match existing users in Firebase Auth emulator
 */
export const TEST_USERS: Record<string, TestUser> = {
  // Primary user - woman, 25, premium, verified, established tier, has private content
  alice: {
    id: 'test-user-a',
    email: 'test-user-a@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Alice Test',
    storageStatePath: '.auth/alice.json',
    birthDate: ageToDate(25),
    city: 'New York',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Looking for genuine connections',
    isPremium: true,
    isVerified: true,
    reputationTier: 'established',
    testImage: 'test-user-woman.jpg',
    hasPrivateContent: true, // Alice has private photos for testing access requests
  },

  // Primary user - man, 28, free, verified, active tier, has private content
  bob: {
    id: 'test-user-b',
    email: 'test-user-b@e2e.test',
    password: 'TestPassword456!',
    displayName: 'Bob Test',
    storageStatePath: '.auth/bob.json',
    birthDate: ageToDate(28),
    city: 'Los Angeles',
    gender: 'man',
    interestedIn: ['women'],
    tagline: 'Here for meaningful relationships',
    isPremium: false,
    isVerified: true,
    reputationTier: 'active',
    testImage: 'test-user-man.png',
    hasPrivateContent: true, // Bob has private photos for testing access requests
  },
};

/**
 * Extended test users - for comprehensive discover page testing
 * These represent different permutations of user properties including all reputation tiers
 */
export const DISCOVER_TEST_USERS: Record<string, TestUser> = {
  // NEW tier user - man, 29, free, unverified
  newTierUser: {
    id: 'test-new-tier',
    email: 'new-tier@e2e.test',
    password: 'TestPassword123!',
    displayName: 'New Nick',
    storageStatePath: '.auth/new-tier.json',
    birthDate: ageToDate(29),
    city: 'Miami',
    gender: 'man',
    interestedIn: ['women'],
    tagline: 'Just getting started',
    isPremium: false,
    isVerified: false,
    reputationTier: 'new',
    testImage: 'test-user-man.png',
  },

  // ACTIVE tier user - woman, 22, premium, verified
  activeTierUser: {
    id: 'test-active-tier',
    email: 'active-tier@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Active Anna',
    storageStatePath: '.auth/active-tier.json',
    birthDate: ageToDate(22),
    city: 'Chicago',
    gender: 'woman',
    interestedIn: ['men', 'women'],
    tagline: 'Active and engaged',
    isPremium: true,
    isVerified: true,
    reputationTier: 'active',
    testImage: 'test-user-woman.jpg',
  },

  // ESTABLISHED tier user - woman, 32, free, verified
  establishedTierUser: {
    id: 'test-established-tier',
    email: 'established-tier@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Established Emma',
    storageStatePath: '.auth/established-tier.json',
    birthDate: ageToDate(32),
    city: 'Seattle',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Established member',
    isPremium: false,
    isVerified: true,
    reputationTier: 'established',
    testImage: 'test-user-woman.jpg',
  },

  // TRUSTED tier user - woman, 30, premium, verified
  trustedTierUser: {
    id: 'test-trusted-tier',
    email: 'trusted-tier@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Trusted Tina',
    storageStatePath: '.auth/trusted-tier.json',
    birthDate: ageToDate(30),
    city: 'Denver',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Trusted community member',
    isPremium: true,
    isVerified: true,
    reputationTier: 'trusted',
    testImage: 'test-user-woman.jpg',
  },

  // DISTINGUISHED tier user - woman, 35, verified
  distinguishedTierUser: {
    id: 'test-distinguished-tier',
    email: 'distinguished-tier@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Distinguished Diana',
    storageStatePath: '.auth/distinguished-tier.json',
    birthDate: ageToDate(35),
    city: 'Portland',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Distinguished member',
    isPremium: false,
    isVerified: true,
    reputationTier: 'distinguished',
    testImage: 'test-user-woman.jpg',
  },

  // Nonbinary user, 30, premium, active tier
  nonbinaryUser: {
    id: 'test-nonbinary-30',
    email: 'nonbinary-30@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Nonbinary Noel',
    storageStatePath: '.auth/nonbinary-30.json',
    birthDate: ageToDate(30),
    city: 'Austin',
    gender: 'nonbinary',
    interestedIn: ['men', 'women', 'nonbinary'],
    tagline: 'Open to all connections',
    isPremium: true,
    isVerified: false,
    reputationTier: 'active',
    testImage: 'test-user-woman.jpg',
  },

  // Second NEW tier user - woman, 24, for same-tier messaging tests
  newTierUser2: {
    id: 'test-new-tier-2',
    email: 'new-tier-2@e2e.test',
    password: 'TestPassword123!',
    displayName: 'New Nancy',
    storageStatePath: '.auth/new-tier-2.json',
    birthDate: ageToDate(24),
    city: 'Miami',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Also just getting started',
    isPremium: false,
    isVerified: false,
    reputationTier: 'new',
    testImage: 'test-user-woman.jpg',
  },
};

/**
 * Get all test users (primary + discover)
 */
export function getAllTestUsers(): TestUser[] {
  return [...Object.values(TEST_USERS), ...Object.values(DISCOVER_TEST_USERS)];
}

/**
 * Get user by ID
 */
export function getUserById(id: string): TestUser | undefined {
  return getAllTestUsers().find(u => u.id === id);
}

/**
 * Get users by reputation tier
 */
export function getUsersByTier(tier: ReputationTier): TestUser[] {
  return getAllTestUsers().filter(u => u.reputationTier === tier);
}

/**
 * Get a user with a specific tier (returns first match)
 */
export function getUserWithTier(tier: ReputationTier): TestUser | undefined {
  return getAllTestUsers().find(u => u.reputationTier === tier);
}

/**
 * Compare tiers - returns positive if tier1 > tier2
 */
export function compareTiers(tier1: ReputationTier, tier2: ReputationTier): number {
  return TIER_ORDER.indexOf(tier1) - TIER_ORDER.indexOf(tier2);
}

export const AUTH_EMULATOR_URL = 'http://localhost:9099';
export const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
