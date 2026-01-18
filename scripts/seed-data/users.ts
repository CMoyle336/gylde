/**
 * Dynamic user data generation using Faker.js
 */

import { faker } from '@faker-js/faker';

// ============================================================================
// CONSTANTS (matching app/src/app/core/constants/connection-types.ts)
// ============================================================================

const RELATIONSHIP_GOALS = [
  'long-term', 'marriage-minded', 'romance', 'friends-first', 
  'casual', 'travel-partner', 'mentorship'
];

const RELATIONSHIP_STYLE = [
  'monogamous', 'non-monogamous', 'open-relationship', 'discretion'
];

const LIFESTYLE_PREFERENCES = [
  'luxury-lifestyle', 'active-lifestyle', 'jet-setter', 'foodie',
  'nightlife', 'cultural', 'homebody', 'adventurous',
  'health-conscious', 'career-driven', 'laid-back', 'social-butterfly'
];

const ALL_CONNECTION_TYPES = [...RELATIONSHIP_GOALS, ...RELATIONSHIP_STYLE, ...LIFESTYLE_PREFERENCES];

const SUPPORT_ORIENTATIONS = ['providing', 'receiving', 'either', 'private'];

const GENDER_IDENTITIES = ['woman', 'man', 'nonbinary'];

const ETHNICITY_OPTIONS = [
  'Asian', 'Black/African', 'Hispanic/Latino', 'Middle Eastern',
  'Native American', 'Pacific Islander', 'White/Caucasian', 'Mixed', 'Other'
];

const RELATIONSHIP_STATUS_OPTIONS = [
  'Single', 'Divorced', 'Separated', 'Widowed', 'In a relationship', 'Married'
];

const CHILDREN_OPTIONS = [
  'No children', 'Have children', 'Want children', "Don't want children"
];

const SMOKING_OPTIONS = ['Non-smoker', 'Occasional smoker', 'Regular smoker'];

const DRINKING_OPTIONS = ['Non-drinker', 'Social drinker', 'Regular drinker'];

const EDUCATION_OPTIONS = [
  'High school', 'Some college', "Associate's degree", 
  "Bachelor's degree", "Master's degree", 'Doctorate', 'Trade school'
];

const INCOME_OPTIONS = [
  'Under $50,000', '$50,000 - $100,000', '$100,000 - $150,000', '$150,000 - $200,000',
  '$200,000 - $300,000', '$300,000 - $500,000', '$500,000 - $1,000,000', 'Over $1,000,000'
];

const VERIFICATION_OPTIONS = ['identity', 'photo', 'income'];

// Reputation tiers (matching app/src/app/core/interfaces/reputation.interface.ts)
const REPUTATION_TIERS = ['new', 'active', 'established', 'trusted', 'distinguished'] as const;
type ReputationTier = typeof REPUTATION_TIERS[number];

// Cities in Michigan area for realistic location clustering
const MICHIGAN_CITIES = [
  { city: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458 },
  { city: 'Ann Arbor', state: 'MI', lat: 42.2808, lng: -83.7430 },
  { city: 'Grand Rapids', state: 'MI', lat: 42.9634, lng: -85.6681 },
  { city: 'Royal Oak', state: 'MI', lat: 42.4895, lng: -83.1446 },
  { city: 'Troy', state: 'MI', lat: 42.6064, lng: -83.1498 },
  { city: 'Birmingham', state: 'MI', lat: 42.5467, lng: -83.2113 },
  { city: 'Ferndale', state: 'MI', lat: 42.4606, lng: -83.1346 },
  { city: 'Plymouth', state: 'MI', lat: 42.3714, lng: -83.4702 },
  { city: 'Ypsilanti', state: 'MI', lat: 42.2411, lng: -83.6129 },
  { city: 'Dearborn', state: 'MI', lat: 42.3223, lng: -83.1763 },
  { city: 'Bloomfield Hills', state: 'MI', lat: 42.5839, lng: -83.2455 },
  { city: 'Novi', state: 'MI', lat: 42.4801, lng: -83.4755 },
];

// Sample profile photos
const SAMPLE_PHOTOS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400&h=400&fit=crop',
];

// ============================================================================
// INTERFACES
// ============================================================================

export interface SeedUser {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  photoURL: string | null;
  onboardingCompleted: boolean;
  lastActiveAt: Date;
  
  // Verification status fields
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  identityVerified: boolean;
  identityVerificationStatus: 'pending' | 'approved' | 'declined' | null;
  
  // Reputation (denormalized for display, full data in private subcollection)
  reputationTier: ReputationTier;
  reputation: {
    tier: ReputationTier;
    dailyMessageLimit: number;
    messagesSentToday: number;
    canMessageMinTier: ReputationTier;
  };
  
  settings: {
    privacy: {
      showOnlineStatus: boolean;
      showLastActive: boolean;
      profileVisible: boolean;
    };
    notifications: {
      messages: boolean;
      matches: boolean;
      favorites: boolean;
      views: boolean;
    };
  };
  onboarding: {
    birthDate: string;
    city: string;
    country: string;
    location: { latitude: number; longitude: number };
    genderIdentity: string;
    interestedIn: string[];
    ageRangeMin: number;
    ageRangeMax: number;
    connectionTypes: string[];
    supportOrientation: string;
    tagline: string;
    idealRelationship: string;
    supportMeaning: string;
    photos: string[];
    photoDetails: SeedPhotoDetail[];
    verificationOptions: string[];
    // Secondary profile fields
    height?: string;
    weight?: string;
    ethnicity?: string;
    relationshipStatus?: string;
    children?: string;
    smoker?: string;
    drinker?: string;
    education?: string;
    occupation?: string;
    income?: string;
  };
}

export interface SeedFavorite {
  odId: string;
  odUserId: string;
  odTargetUserId: string;
  createdAt: Date;
}

export interface SeedProfileView {
  odId: string;
  viewerId: string;
  viewedUserId: string;
  viewerName: string;
  viewerPhoto: string | null;
  viewedAt: Date;
}

export interface SeedMatch {
  odId: string;
  user1Id: string;
  user2Id: string;
  matchedAt: Date;
}

export interface SeedActivity {
  odId: string;
  userId: string; // The user who receives this activity
  type: 'favorite' | 'match' | 'view' | 'message';
  fromUserId: string;
  fromUserName: string;
  fromUserPhoto: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
}

export interface SeedPhotoDetail {
  url: string;
  isPrivate: boolean;
  order: number;
}

export interface SeedPhotoAccessRequest {
  odId: string;
  targetUserId: string;  // Owner of the photos
  requesterId: string;   // Person requesting access
  requesterName: string;
  requesterPhoto: string | null;
  status: 'pending';
  requestedAt: Date;
}

export interface SeedMessage {
  odId: string;
  odConversationId: string;
  odSenderId: string;
  content: string;
  createdAt: Date;
  read: boolean;
}

export interface SeedConversation {
  odId: string;
  odParticipants: string[];
  lastMessageAt: Date;
  lastMessage: string;
  lastSenderId: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomMultiple<T>(arr: T[], min: number, max: number): T[] {
  const count = faker.number.int({ min, max });
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateBirthDate(minAge: number, maxAge: number): string {
  const age = faker.number.int({ min: minAge, max: maxAge });
  const birthYear = new Date().getFullYear() - age;
  const birthMonth = faker.number.int({ min: 1, max: 12 });
  const birthDay = faker.number.int({ min: 1, max: 28 });
  return `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
}

function generateHeight(): string {
  const feet = faker.number.int({ min: 5, max: 6 });
  const inches = faker.number.int({ min: 0, max: 11 });
  return `${feet}'${inches}"`;
}

function generateWeight(): string {
  const lbs = faker.number.int({ min: 110, max: 220 });
  return `${lbs} lbs`;
}

function getInterestedIn(gender: string): string[] {
  // Realistic distribution of preferences
  const roll = Math.random();
  if (gender === 'woman') {
    if (roll < 0.85) return ['men'];
    if (roll < 0.95) return ['women'];
    return ['men', 'women'];
  } else if (gender === 'man') {
    if (roll < 0.85) return ['women'];
    if (roll < 0.95) return ['men'];
    return ['men', 'women'];
  } else {
    // nonbinary - more varied preferences
    return pickRandomMultiple(['men', 'women', 'nonbinary'], 1, 3);
  }
}

// ============================================================================
// GENERATION FUNCTIONS
// ============================================================================

export function generateUsers(count: number, seed?: number): SeedUser[] {
  if (seed !== undefined) {
    faker.seed(seed);
  }

  const users: SeedUser[] = [];

  for (let i = 0; i < count; i++) {
    const uid = `seed-user-${String(i + 1).padStart(3, '0')}`;
    const gender = pickRandom(GENDER_IDENTITIES);
    const sex = gender === 'woman' ? 'female' : gender === 'man' ? 'male' : pickRandom(['female', 'male']);
    const firstName = faker.person.firstName(sex as 'female' | 'male');
    const lastName = faker.person.lastName();
    const displayName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}${i + 1}@test.com`;

    const location = pickRandom(MICHIGAN_CITIES);
    // Ensure at least 3 photos so we have room for private photos
    const photos = pickRandomMultiple(SAMPLE_PHOTOS, 3, 5);
    
    // Generate photo details with privacy - first photo is never private (it's the profile photo)
    // Ensure everyone has 1-2 private photos for testing
    const numPrivatePhotos = faker.number.int({ min: 1, max: 2 });
    const photoDetails: SeedPhotoDetail[] = photos.map((url, index) => ({
      url,
      // First photo is never private, then mark some as private
      isPrivate: index > 0 && index <= numPrivatePhotos,
      order: index,
    }));
    
    // Age range for this user
    const userAge = faker.number.int({ min: 21, max: 55 });
    const ageRangeMin = Math.max(18, userAge - faker.number.int({ min: 5, max: 15 }));
    const ageRangeMax = Math.min(70, userAge + faker.number.int({ min: 5, max: 20 }));

    // Activity - some users very recent, some older
    const now = Date.now();
    let lastActiveAt: Date;
    const activityRoll = Math.random();
    if (activityRoll < 0.3) {
      // 30% - online now (within 15 minutes)
      lastActiveAt = new Date(now - faker.number.int({ min: 0, max: 15 * 60 * 1000 }));
    } else if (activityRoll < 0.6) {
      // 30% - active today
      lastActiveAt = new Date(now - faker.number.int({ min: 15 * 60 * 1000, max: 24 * 60 * 60 * 1000 }));
    } else if (activityRoll < 0.85) {
      // 25% - active this week
      lastActiveAt = new Date(now - faker.number.int({ min: 24 * 60 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 }));
    } else {
      // 15% - inactive for a while
      lastActiveAt = new Date(now - faker.number.int({ min: 7 * 24 * 60 * 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 }));
    }

    // Generate verification statuses
    // ~70% of users have verified email
    const emailVerified = Math.random() > 0.3;
    // ~40% of users have verified phone
    const hasPhoneVerified = Math.random() > 0.6;
    // Generate E.164 format phone number
    const phoneNumber = hasPhoneVerified 
      ? `+1${faker.string.numeric(10)}` 
      : null;
    // ~30% of users have completed identity verification
    const identityRoll = Math.random();
    const identityVerified = identityRoll > 0.7;
    const identityVerificationStatus: 'pending' | 'approved' | 'declined' | null = 
      identityVerified ? 'approved' : 
      (identityRoll > 0.5 ? 'pending' : null);

    // Generate reputation tier with realistic distribution
    // 30% new, 35% active, 20% established, 12% trusted, 3% distinguished
    const reputationRoll = Math.random();
    let reputationTier: ReputationTier;
    if (reputationRoll < 0.30) {
      reputationTier = 'new';
    } else if (reputationRoll < 0.65) {
      reputationTier = 'active';
    } else if (reputationRoll < 0.85) {
      reputationTier = 'established';
    } else if (reputationRoll < 0.97) {
      reputationTier = 'trusted';
    } else {
      reputationTier = 'distinguished';
    }

    // Daily message limits by tier (matching backend config)
    const dailyMessageLimits: Record<ReputationTier, number> = {
      new: 5,
      active: 15,
      established: 30,
      trusted: 50,
      distinguished: 100,
    };

    // canMessageMinTier by tier (matching backend config)
    const canMessageMinTiers: Record<ReputationTier, ReputationTier> = {
      new: 'active',
      active: 'new',
      established: 'new',
      trusted: 'new',
      distinguished: 'new',
    };

    const user: SeedUser = {
      uid,
      email,
      password: 'password123',
      displayName,
      photoURL: photos[0],
      onboardingCompleted: true,
      lastActiveAt,
      
      // Verification fields
      emailVerified,
      phoneNumber,
      phoneNumberVerified: hasPhoneVerified,
      identityVerified,
      identityVerificationStatus,
      
      // Reputation fields
      reputationTier,
      reputation: {
        tier: reputationTier,
        dailyMessageLimit: dailyMessageLimits[reputationTier],
        messagesSentToday: 0,
        canMessageMinTier: canMessageMinTiers[reputationTier],
      },
      
      settings: {
        privacy: {
          showOnlineStatus: Math.random() > 0.1, // 90% show online status
          showLastActive: Math.random() > 0.15, // 85% show last active
          profileVisible: true,
        },
        notifications: {
          messages: true,
          matches: true,
          favorites: Math.random() > 0.2,
          views: Math.random() > 0.3,
        },
      },
      onboarding: {
        birthDate: generateBirthDate(userAge, userAge),
        city: location.city,
        country: 'US',
        location: { latitude: location.lat, longitude: location.lng },
        genderIdentity: gender,
        interestedIn: getInterestedIn(gender),
        ageRangeMin,
        ageRangeMax,
        connectionTypes: pickRandomMultiple(ALL_CONNECTION_TYPES, 2, 5),
        supportOrientation: pickRandom(SUPPORT_ORIENTATIONS),
        tagline: faker.person.bio(),
        idealRelationship: faker.lorem.paragraph({ min: 1, max: 3 }),
        supportMeaning: faker.lorem.sentence({ min: 8, max: 20 }),
        photos,
        photoDetails,
        verificationOptions: pickRandomMultiple(VERIFICATION_OPTIONS, 0, 2),
        // Secondary fields - not all users fill these out
        ...(Math.random() > 0.3 && { height: generateHeight() }),
        ...(Math.random() > 0.5 && { weight: generateWeight() }),
        ...(Math.random() > 0.2 && { ethnicity: pickRandom(ETHNICITY_OPTIONS) }),
        ...(Math.random() > 0.3 && { relationshipStatus: pickRandom(RELATIONSHIP_STATUS_OPTIONS) }),
        ...(Math.random() > 0.4 && { children: pickRandom(CHILDREN_OPTIONS) }),
        ...(Math.random() > 0.5 && { smoker: pickRandom(SMOKING_OPTIONS) }),
        ...(Math.random() > 0.4 && { drinker: pickRandom(DRINKING_OPTIONS) }),
        ...(Math.random() > 0.3 && { education: pickRandom(EDUCATION_OPTIONS) }),
        ...(Math.random() > 0.3 && { occupation: faker.person.jobTitle() }),
        ...(Math.random() > 0.4 && { income: pickRandom(INCOME_OPTIONS) }),
      },
    };

    users.push(user);
  }

  return users;
}

export function generateFavorites(users: SeedUser[], avgFavoritesPerUser: number = 3): SeedFavorite[] {
  const favorites: SeedFavorite[] = [];
  const existingPairs = new Set<string>();

  for (const user of users) {
    const numFavorites = faker.number.int({ min: 0, max: avgFavoritesPerUser * 2 });
    const potentialTargets = users.filter(u => 
      u.uid !== user.uid && 
      // Basic compatibility check
      u.onboarding.interestedIn.includes(user.onboarding.genderIdentity) &&
      user.onboarding.interestedIn.includes(u.onboarding.genderIdentity)
    );

    const targets = potentialTargets
      .sort(() => Math.random() - 0.5)
      .slice(0, numFavorites);

    for (const target of targets) {
      const pairKey = `${user.uid}-${target.uid}`;
      if (!existingPairs.has(pairKey)) {
        existingPairs.add(pairKey);
        favorites.push({
          odId: faker.string.uuid(),
          odUserId: user.uid,
          odTargetUserId: target.uid,
          createdAt: faker.date.recent({ days: 30 }),
        });
      }
    }
  }

  return favorites;
}

export function generateProfileViews(users: SeedUser[], avgViewsPerUser: number = 5): SeedProfileView[] {
  const views: SeedProfileView[] = [];
  const viewPairs = new Set<string>();

  for (const user of users) {
    const numViews = faker.number.int({ min: 0, max: avgViewsPerUser * 2 });
    const potentialViewers = users.filter(u => u.uid !== user.uid);
    const viewers = potentialViewers
      .sort(() => Math.random() - 0.5)
      .slice(0, numViews);

    for (const viewer of viewers) {
      const pairKey = `${viewer.uid}-${user.uid}`;
      if (viewPairs.has(pairKey)) continue;
      viewPairs.add(pairKey);

      views.push({
        odId: faker.string.uuid(),
        viewerId: viewer.uid,
        viewedUserId: user.uid,
        viewerName: viewer.displayName,
        viewerPhoto: viewer.photoURL,
        viewedAt: faker.date.recent({ days: 14 }),
      });
    }
  }

  return views;
}

export function generateMatches(
  users: SeedUser[],
  favorites: SeedFavorite[]
): SeedMatch[] {
  const matches: SeedMatch[] = [];
  const favoriteMap = new Map<string, Date>();

  // Build a map of who favorited whom
  for (const fav of favorites) {
    favoriteMap.set(`${fav.odUserId}-${fav.odTargetUserId}`, fav.createdAt);
  }

  // Find mutual favorites
  const processedPairs = new Set<string>();
  for (const fav of favorites) {
    const reverseKey = `${fav.odTargetUserId}-${fav.odUserId}`;
    const pairKey = [fav.odUserId, fav.odTargetUserId].sort().join('-');

    if (favoriteMap.has(reverseKey) && !processedPairs.has(pairKey)) {
      processedPairs.add(pairKey);
      
      // Match date is when the second favorite happened
      const otherFavDate = favoriteMap.get(reverseKey)!;
      const matchedAt = fav.createdAt > otherFavDate ? fav.createdAt : otherFavDate;

      matches.push({
        odId: faker.string.uuid(),
        user1Id: fav.odUserId,
        user2Id: fav.odTargetUserId,
        matchedAt,
      });
    }
  }

  return matches;
}

export function generateActivities(
  users: SeedUser[],
  favorites: SeedFavorite[],
  matches: SeedMatch[],
  views: SeedProfileView[]
): SeedActivity[] {
  const activities: SeedActivity[] = [];
  const userMap = new Map(users.map(u => [u.uid, u]));

  // Generate favorite activities
  for (const fav of favorites) {
    const fromUser = userMap.get(fav.odUserId);
    if (!fromUser) continue;

    activities.push({
      odId: faker.string.uuid(),
      userId: fav.odTargetUserId, // The person being favorited receives the activity
      type: 'favorite',
      fromUserId: fav.odUserId,
      fromUserName: fromUser.displayName,
      fromUserPhoto: fromUser.photoURL,
      link: `/user/${fav.odUserId}`,
      read: Math.random() > 0.3, // 70% read
      createdAt: fav.createdAt,
    });
  }

  // Generate match activities (both users get one)
  for (const match of matches) {
    const user1 = userMap.get(match.user1Id);
    const user2 = userMap.get(match.user2Id);
    if (!user1 || !user2) continue;

    activities.push({
      odId: faker.string.uuid(),
      userId: match.user1Id,
      type: 'match',
      fromUserId: match.user2Id,
      fromUserName: user2.displayName,
      fromUserPhoto: user2.photoURL,
      link: `/user/${match.user2Id}`,
      read: Math.random() > 0.4,
      createdAt: match.matchedAt,
    });

    activities.push({
      odId: faker.string.uuid(),
      userId: match.user2Id,
      type: 'match',
      fromUserId: match.user1Id,
      fromUserName: user1.displayName,
      fromUserPhoto: user1.photoURL,
      link: `/user/${match.user1Id}`,
      read: Math.random() > 0.4,
      createdAt: match.matchedAt,
    });
  }

  // Generate view activities (limit to some percentage)
  const viewsToProcess = views.filter(() => Math.random() > 0.6); // Only 40% of views generate activities
  for (const view of viewsToProcess) {
    activities.push({
      odId: faker.string.uuid(),
      userId: view.viewedUserId,
      type: 'view',
      fromUserId: view.viewerId,
      fromUserName: view.viewerName,
      fromUserPhoto: view.viewerPhoto,
      link: `/user/${view.viewerId}`,
      read: Math.random() > 0.5,
      createdAt: view.viewedAt,
    });
  }

  return activities;
}

export function generateConversationsAndMessages(
  users: SeedUser[],
  avgConversationsPerUser: number = 2
): { conversations: SeedConversation[]; messages: SeedMessage[] } {
  const conversations: SeedConversation[] = [];
  const messages: SeedMessage[] = [];
  const existingPairs = new Set<string>();

  const messageTemplates = [
    "Hey! I saw your profile and thought we might have some things in common 😊",
    "Hi there! Love your photos. Would you like to chat?",
    "Hello! I noticed we're both into {interest}. That's awesome!",
    "Hey, your profile really stood out to me. How's your day going?",
    "Hi! I'd love to get to know you better. What do you do for fun?",
    "Thanks for matching! What brings you to this app?",
    "Hey! I see you're from {city}. I love it there!",
    "Hi! Your bio made me smile. Care to chat?",
    "Hello! You seem really interesting. Tell me more about yourself?",
    "Hey there! I think we'd get along well. What do you think?",
  ];

  const replyTemplates = [
    "Thanks for reaching out! I'd love to chat more.",
    "Hey! Nice to meet you too. How's your week been?",
    "Hi! Thanks, I appreciate that. What about you?",
    "Hello! Great to hear from you. Let's definitely chat more.",
    "Hey! I'm doing well, thanks for asking. What are you up to?",
    "Thanks! I've been pretty busy but always have time for good conversation.",
    "Hi! Yes, I'd love to get to know you better too.",
    "Hey there! Your profile is great too. What are your hobbies?",
  ];

  for (const user of users) {
    const numConversations = faker.number.int({ min: 0, max: avgConversationsPerUser * 2 });
    const potentialPartners = users.filter(u => 
      u.uid !== user.uid &&
      u.onboarding.interestedIn.includes(user.onboarding.genderIdentity) &&
      user.onboarding.interestedIn.includes(u.onboarding.genderIdentity)
    );

    const partners = potentialPartners
      .sort(() => Math.random() - 0.5)
      .slice(0, numConversations);

    for (const partner of partners) {
      const pairKey = [user.uid, partner.uid].sort().join('-');
      if (existingPairs.has(pairKey)) continue;
      existingPairs.add(pairKey);

      const conversationId = faker.string.uuid();
      const numMessages = faker.number.int({ min: 2, max: 10 });
      const conversationStart = faker.date.recent({ days: 14 });
      
      let lastMessage = '';
      let lastSenderId = '';
      let currentTime = conversationStart;

      for (let i = 0; i < numMessages; i++) {
        const isFirstMessage = i === 0;
        const sender = i % 2 === 0 ? user : partner;
        const template = isFirstMessage 
          ? pickRandom(messageTemplates)
          : pickRandom(replyTemplates);
        
        const content = template
          .replace('{interest}', pickRandom(sender.onboarding.connectionTypes))
          .replace('{city}', sender.onboarding.city);

        // Add some time between messages
        currentTime = new Date(currentTime.getTime() + faker.number.int({ min: 60000, max: 86400000 }));

        const message: SeedMessage = {
          odId: faker.string.uuid(),
          odConversationId: conversationId,
          odSenderId: sender.uid,
          content,
          createdAt: currentTime,
          read: i < numMessages - 1 || Math.random() > 0.3, // Last message might be unread
        };

        messages.push(message);
        lastMessage = content;
        lastSenderId = sender.uid;
      }

      conversations.push({
        odId: conversationId,
        odParticipants: [user.uid, partner.uid],
        lastMessageAt: currentTime,
        lastMessage,
        lastSenderId,
      });
    }
  }

  return { conversations, messages };
}

/**
 * Generate photo access requests - everyone requests access from everyone else who has private photos
 */
export function generatePhotoAccessRequests(users: SeedUser[]): SeedPhotoAccessRequest[] {
  const requests: SeedPhotoAccessRequest[] = [];

  // Find users with private photos
  const usersWithPrivatePhotos = users.filter(u => 
    u.onboarding.photoDetails.some(p => p.isPrivate)
  );

  // Each user requests access to all other users' private photos
  for (const requester of users) {
    for (const owner of usersWithPrivatePhotos) {
      // Skip self
      if (requester.uid === owner.uid) continue;

      requests.push({
        odId: faker.string.uuid(),
        targetUserId: owner.uid,
        requesterId: requester.uid,
        requesterName: requester.displayName,
        requesterPhoto: requester.photoURL,
        status: 'pending',
        requestedAt: faker.date.recent({ days: 7 }),
      });
    }
  }

  return requests;
}

// ============================================================================
// MAIN EXPORT FOR BACKWARD COMPATIBILITY
// ============================================================================

// Default export: generate 20 users with a fixed seed for reproducibility
export const sampleUsers = generateUsers(20, 12345);
