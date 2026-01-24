/**
 * Test user definitions for e2e tests
 * These users are created during auth setup and represent different user types
 */

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
  reputationTier?: 'new' | 'rising' | 'established' | 'trusted' | 'exemplary';
  testImage: string; // Which test image to use
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
  // Primary user - woman, 25, premium, verified
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
  },

  // Primary user - man, 28, free, verified
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
    reputationTier: 'rising',
    testImage: 'test-user-man.png',
  },
};

/**
 * Extended test users - for comprehensive discover page testing
 * These represent different permutations of user properties
 */
export const DISCOVER_TEST_USERS: Record<string, TestUser> = {
  // Premium verified woman, 22, trusted
  premiumWoman22: {
    id: 'test-premium-woman-22',
    email: 'premium-woman-22@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Premium Patty',
    storageStatePath: '.auth/premium-woman-22.json',
    birthDate: ageToDate(22),
    city: 'Chicago',
    gender: 'woman',
    interestedIn: ['men', 'women'],
    tagline: 'Premium member looking for quality',
    isPremium: true,
    isVerified: true,
    reputationTier: 'trusted',
    testImage: 'test-user-woman.jpg',
  },

  // Free unverified man, 35, new
  freeMan35: {
    id: 'test-free-man-35',
    email: 'free-man-35@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Free Frank',
    storageStatePath: '.auth/free-man-35.json',
    birthDate: ageToDate(35),
    city: 'Miami',
    gender: 'man',
    interestedIn: ['women'],
    tagline: 'Just getting started',
    isPremium: false,
    isVerified: false,
    reputationTier: 'new',
    testImage: 'test-user-man.png',
  },

  // Verified woman, 45, exemplary reputation
  verifiedWoman45: {
    id: 'test-verified-woman-45',
    email: 'verified-woman-45@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Verified Vera',
    storageStatePath: '.auth/verified-woman-45.json',
    birthDate: ageToDate(45),
    city: 'Seattle',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Mature and looking for the same',
    isPremium: false,
    isVerified: true,
    reputationTier: 'exemplary',
    testImage: 'test-user-woman.jpg',
  },

  // Nonbinary user, 30, premium
  nonbinary30: {
    id: 'test-nonbinary-30',
    email: 'nonbinary-30@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Nonbinary Noel',
    storageStatePath: '.auth/nonbinary-30.json',
    birthDate: ageToDate(30),
    city: 'Portland',
    gender: 'nonbinary',
    interestedIn: ['men', 'women', 'nonbinary'],
    tagline: 'Open to all connections',
    isPremium: true,
    isVerified: false,
    reputationTier: 'rising',
    testImage: 'test-user-woman.jpg', // Use woman image as placeholder
  },

  // Young man, 21, free, new
  youngMan21: {
    id: 'test-young-man-21',
    email: 'young-man-21@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Young Yusuf',
    storageStatePath: '.auth/young-man-21.json',
    birthDate: ageToDate(21),
    city: 'Austin',
    gender: 'man',
    interestedIn: ['women'],
    tagline: 'New here and excited',
    isPremium: false,
    isVerified: false,
    reputationTier: 'new',
    testImage: 'test-user-man.png',
  },

  // Older woman, 55, verified, established
  olderWoman55: {
    id: 'test-older-woman-55',
    email: 'older-woman-55@e2e.test',
    password: 'TestPassword123!',
    displayName: 'Older Olivia',
    storageStatePath: '.auth/older-woman-55.json',
    birthDate: ageToDate(55),
    city: 'Denver',
    gender: 'woman',
    interestedIn: ['men'],
    tagline: 'Age is just a number',
    isPremium: false,
    isVerified: true,
    reputationTier: 'established',
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

export const AUTH_EMULATOR_URL = 'http://localhost:9099';
export const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
