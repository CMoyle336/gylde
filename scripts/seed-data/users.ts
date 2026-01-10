/**
 * Sample user data for Firestore seeding
 */

export interface SeedUser {
  uid: string;
  email: string;
  password: string; // For Firebase Auth
  displayName: string;
  photoURL: string | null;
  onboardingCompleted: boolean;
  onboarding: {
    birthDate: string;
    city: string;
    country: string;
    location: { latitude: number; longitude: number };
    genderIdentity: string;
    genderCustom?: string;
    interestedIn: string[];
    ageRangeMin: number;
    ageRangeMax: number;
    connectionTypes: string[];
    supportOrientation: string[];
    values: string[];
    lifestyle: string;
    idealRelationship: string;
    supportMeaning?: string;
    photos: string[];
    verificationOptions: string[];
  };
}

// Sample photos from picsum.photos (placeholder images)
const samplePhotos = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=400&fit=crop',
];

export const sampleUsers: SeedUser[] = [
  {
    uid: 'seed-user-001',
    email: 'emma@test.com',
    password: 'password123',
    displayName: 'Emma Wilson',
    photoURL: samplePhotos[0],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1995-03-15',
      city: 'Ann Arbor',
      country: 'US',
      location: { latitude: 42.2808, longitude: -83.7430 },
      genderIdentity: 'woman',
      interestedIn: ['men'],
      ageRangeMin: 28,
      ageRangeMax: 42,
      connectionTypes: ['intentional-dating', 'long-term'],
      supportOrientation: ['receiving', 'mutual'],
      values: ['ambition', 'growth', 'stability'],
      lifestyle: 'somewhat-flexible',
      idealRelationship: 'I\'m looking for a partner who values deep conversations and shared growth. Someone who understands that success takes dedication and wants to build something meaningful together.',
      supportMeaning: 'Support means having someone in my corner who believes in my dreams and helps me reach them.',
      photos: [samplePhotos[0]],
      verificationOptions: ['identity'],
    },
  },
  {
    uid: 'seed-user-002',
    email: 'james@test.com',
    password: 'password123',
    displayName: 'James Chen',
    photoURL: samplePhotos[1],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1988-07-22',
      city: 'Detroit',
      country: 'US',
      location: { latitude: 42.3314, longitude: -83.0458 },
      genderIdentity: 'man',
      interestedIn: ['women'],
      ageRangeMin: 25,
      ageRangeMax: 38,
      connectionTypes: ['intentional-dating', 'mentorship'],
      supportOrientation: ['providing'],
      values: ['generosity', 'ambition', 'adventure'],
      lifestyle: 'very-flexible',
      idealRelationship: 'I\'ve built a successful career and now want to share my life with someone special. Looking for genuine connection, not just surface-level attraction.',
      supportMeaning: 'I believe in lifting up my partner and helping them achieve their full potential.',
      photos: [samplePhotos[1]],
      verificationOptions: ['identity', 'photo'],
    },
  },
  {
    uid: 'seed-user-003',
    email: 'sofia@test.com',
    password: 'password123',
    displayName: 'Sofia Martinez',
    photoURL: samplePhotos[2],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1997-11-08',
      city: 'Ypsilanti',
      country: 'US',
      location: { latitude: 42.2411, longitude: -83.6129 },
      genderIdentity: 'woman',
      interestedIn: ['men', 'women'],
      ageRangeMin: 26,
      ageRangeMax: 45,
      connectionTypes: ['intentional-dating', 'lifestyle-aligned'],
      supportOrientation: ['receiving'],
      values: ['independence', 'emotional-maturity', 'adventure'],
      lifestyle: 'structured',
      idealRelationship: 'Seeking someone who appreciates the finer things in life but also values authentic connection. Travel, culture, and meaningful experiences matter to me.',
      photos: [samplePhotos[2]],
      verificationOptions: [],
    },
  },
  {
    uid: 'seed-user-004',
    email: 'michael@test.com',
    password: 'password123',
    displayName: 'Michael Thompson',
    photoURL: samplePhotos[3],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1985-02-28',
      city: 'Royal Oak',
      country: 'US',
      location: { latitude: 42.4895, longitude: -83.1446 },
      genderIdentity: 'man',
      interestedIn: ['women'],
      ageRangeMin: 24,
      ageRangeMax: 36,
      connectionTypes: ['long-term', 'lifestyle-aligned'],
      supportOrientation: ['providing', 'mutual'],
      values: ['stability', 'generosity', 'growth'],
      lifestyle: 'highly-demanding',
      idealRelationship: 'Entrepreneur looking for a partner who understands the demands of building something from the ground up. Want someone to share the journey with.',
      supportMeaning: 'Being there emotionally and financially for someone I care about.',
      photos: [samplePhotos[3]],
      verificationOptions: ['identity'],
    },
  },
  {
    uid: 'seed-user-005',
    email: 'olivia@test.com',
    password: 'password123',
    displayName: 'Olivia Johnson',
    photoURL: samplePhotos[4],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1999-06-12',
      city: 'Birmingham',
      country: 'US',
      location: { latitude: 42.5467, longitude: -83.2113 },
      genderIdentity: 'woman',
      interestedIn: ['men'],
      ageRangeMin: 30,
      ageRangeMax: 50,
      connectionTypes: ['intentional-dating', 'mentorship'],
      supportOrientation: ['receiving'],
      values: ['ambition', 'adventure', 'emotional-maturity'],
      lifestyle: 'very-flexible',
      idealRelationship: 'Recent graduate looking for someone established who can help guide me while we build a genuine connection. I bring energy, curiosity, and loyalty.',
      photos: [samplePhotos[4]],
      verificationOptions: ['photo'],
    },
  },
  {
    uid: 'seed-user-006',
    email: 'david@test.com',
    password: 'password123',
    displayName: 'David Williams',
    photoURL: samplePhotos[5],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1982-09-05',
      city: 'Troy',
      country: 'US',
      location: { latitude: 42.6064, longitude: -83.1498 },
      genderIdentity: 'man',
      interestedIn: ['women'],
      ageRangeMin: 25,
      ageRangeMax: 40,
      connectionTypes: ['long-term', 'intentional-dating'],
      supportOrientation: ['providing'],
      values: ['stability', 'independence', 'generosity'],
      lifestyle: 'somewhat-flexible',
      idealRelationship: 'Successful professional seeking a genuine partner. Not interested in games or casual dating. Looking for someone ready to build a life together.',
      supportMeaning: 'Taking care of my partner so they can focus on what matters to them.',
      photos: [samplePhotos[5]],
      verificationOptions: ['identity', 'photo'],
    },
  },
  {
    uid: 'seed-user-007',
    email: 'ava@test.com',
    password: 'password123',
    displayName: 'Ava Brown',
    photoURL: samplePhotos[6],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1996-04-20',
      city: 'Ferndale',
      country: 'US',
      location: { latitude: 42.4606, longitude: -83.1346 },
      genderIdentity: 'woman',
      interestedIn: ['men', 'women'],
      ageRangeMin: 28,
      ageRangeMax: 48,
      connectionTypes: ['lifestyle-aligned', 'exploring'],
      supportOrientation: ['mutual'],
      values: ['adventure', 'growth', 'emotional-maturity'],
      lifestyle: 'very-flexible',
      idealRelationship: 'Creative soul looking for someone who appreciates art, travel, and spontaneity. Want a partner who supports my dreams while we create memories together.',
      photos: [samplePhotos[6]],
      verificationOptions: [],
    },
  },
  {
    uid: 'seed-user-008',
    email: 'sarah@test.com',
    password: 'password123',
    displayName: 'Sarah Davis',
    photoURL: samplePhotos[7],
    onboardingCompleted: true,
    onboarding: {
      birthDate: '1993-12-03',
      city: 'Plymouth',
      country: 'US',
      location: { latitude: 42.3714, longitude: -83.4702 },
      genderIdentity: 'woman',
      interestedIn: ['men'],
      ageRangeMin: 32,
      ageRangeMax: 55,
      connectionTypes: ['intentional-dating', 'long-term'],
      supportOrientation: ['receiving', 'mutual'],
      values: ['stability', 'ambition', 'generosity'],
      lifestyle: 'structured',
      idealRelationship: 'Looking for a mature, established partner who knows what they want. I value honesty, communication, and building a secure future together.',
      supportMeaning: 'Having someone who provides stability and security while we grow together.',
      photos: [samplePhotos[7]],
      verificationOptions: ['identity'],
    },
  },
];
