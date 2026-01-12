/**
 * Firestore Seed Script
 * 
 * Populates the Firestore emulator with sample data for development.
 * 
 * Usage:
 *   npm run seed                    # Create 20 users (default)
 *   npm run seed -- --count 50      # Create 50 users
 *   npm run seed -- --clear         # Clear existing data first
 *   npm run seed -- --clear --count 100  # Clear and create 100 users
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { 
  generateUsers, 
  generateFavorites, 
  generateProfileViews, 
  generateConversationsAndMessages,
  SeedUser,
} from './seed-data/users';

// Configuration
const FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'gylde-dba55';

// Parse command line arguments
const args = process.argv.slice(2);
const shouldClear = args.includes('--clear');
const countIndex = args.indexOf('--count');
const userCount = countIndex !== -1 && args[countIndex + 1] 
  ? parseInt(args[countIndex + 1], 10) 
  : 20;

async function main() {
  console.log('🌱 Firestore Seed Script');
  console.log('========================\n');

  // Connect to emulators
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  
  initializeApp({
    projectId: PROJECT_ID,
  });

  const db = getFirestore();
  const auth = getAuth();
  
  console.log(`📡 Connected to emulators:`);
  console.log(`   Firestore: ${FIRESTORE_EMULATOR_HOST}`);
  console.log(`   Auth: ${AUTH_EMULATOR_HOST}`);
  console.log(`📁 Project: ${PROJECT_ID}`);
  console.log(`👥 User count: ${userCount}\n`);

  if (shouldClear) {
    console.log('🗑️  Clearing existing data...');
    await clearAuthUsers(auth);
    await clearCollection(db, 'users');
    await clearCollection(db, 'conversations');
    console.log('✅ Data cleared\n');
  }

  // Generate all data
  console.log(`🎲 Generating ${userCount} users with faker.js...`);
  const users = generateUsers(userCount, 12345); // Fixed seed for reproducibility
  console.log(`   ✓ Generated ${users.length} user profiles`);

  const favorites = generateFavorites(users, 3);
  console.log(`   ✓ Generated ${favorites.length} favorites`);

  const views = generateProfileViews(users, 5);
  console.log(`   ✓ Generated ${views.length} profile views`);

  const { conversations, messages } = generateConversationsAndMessages(users, 2);
  console.log(`   ✓ Generated ${conversations.length} conversations with ${messages.length} messages`);

  // Seed auth users
  console.log('\n🔐 Creating Auth users...');
  await seedAuthUsers(auth, users);

  // Seed Firestore users
  console.log('\n👥 Seeding Firestore profiles...');
  await seedFirestoreUsers(db, users);

  // Seed favorites
  console.log('\n❤️  Seeding favorites...');
  await seedFavorites(db, favorites);

  // Seed profile views
  console.log('\n👀 Seeding profile views...');
  await seedProfileViews(db, views);

  // Seed conversations and messages
  console.log('\n💬 Seeding conversations and messages...');
  await seedConversations(db, conversations, messages);
  
  console.log('\n🎉 Seeding complete!');
  printLoginCredentials(users);
  
  process.exit(0);
}

// ============================================================================
// SEEDING FUNCTIONS
// ============================================================================

async function seedAuthUsers(auth: ReturnType<typeof getAuth>, users: SeedUser[]) {
  let created = 0;
  let skipped = 0;

  for (const user of users) {
    try {
      await auth.createUser({
        uid: user.uid,
        email: user.email,
        password: user.password,
        displayName: user.displayName,
        photoURL: user.photoURL || undefined,
        emailVerified: true,
      });
      created++;
    } catch (error: any) {
      if (error.code === 'auth/uid-already-exists' || error.code === 'auth/email-already-exists') {
        skipped++;
      } else {
        console.error(`  ✗ ${user.email}: ${error.message}`);
      }
    }
  }
  
  console.log(`✅ Auth users: ${created} created, ${skipped} skipped (already exist)`);
}

/**
 * Generate a geohash for a lat/lng coordinate
 */
function encodeGeohash(latitude: number, longitude: number, precision: number = 9): string {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latRange = { min: -90, max: 90 };
  let lngRange = { min: -180, max: 180 };
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngRange.min + lngRange.max) / 2;
      if (longitude >= mid) {
        ch |= 1 << (4 - bit);
        lngRange.min = mid;
      } else {
        lngRange.max = mid;
      }
    } else {
      const mid = (latRange.min + latRange.max) / 2;
      if (latitude >= mid) {
        ch |= 1 << (4 - bit);
        latRange.min = mid;
      } else {
        latRange.max = mid;
      }
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

async function seedFirestoreUsers(db: FirebaseFirestore.Firestore, users: SeedUser[]) {
  // Process in batches of 500 (Firestore limit)
  const batchSize = 500;
  let totalCreated = 0;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = db.batch();
    const batchUsers = users.slice(i, i + batchSize);

    for (const user of batchUsers) {
      const userRef = db.collection('users').doc(user.uid);
      
      const settings = user.settings;
      const showLastActive = settings?.privacy?.showLastActive !== false;
      const profileVisible = settings?.privacy?.profileVisible !== false;
      
      const isSearchable = profileVisible && user.onboardingCompleted;
      const isVerified = user.onboarding.verificationOptions?.includes('identity') || false;
      const sortableLastActive = showLastActive ? user.lastActiveAt : null;
      
      const location = user.onboarding.location;
      const geohash = location?.latitude && location?.longitude
        ? encodeGeohash(location.latitude, location.longitude, 9)
        : null;
      
      batch.set(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastActiveAt: user.lastActiveAt,
        sortableLastActive,
        isSearchable,
        isVerified,
        geohash,
        onboardingCompleted: user.onboardingCompleted,
        onboarding: user.onboarding,
        settings: user.settings,
      });
    }
    
    await batch.commit();
    totalCreated += batchUsers.length;
    console.log(`  ✓ Created ${totalCreated}/${users.length} profiles`);
  }

  console.log(`✅ Created ${totalCreated} Firestore profiles`);
}

async function seedFavorites(
  db: FirebaseFirestore.Firestore, 
  favorites: { odId: string; odUserId: string; odTargetUserId: string; createdAt: Date }[]
) {
  const batchSize = 500;
  let totalCreated = 0;

  for (let i = 0; i < favorites.length; i += batchSize) {
    const batch = db.batch();
    const batchFavorites = favorites.slice(i, i + batchSize);

    for (const fav of batchFavorites) {
      // Store in user's favorites subcollection
      const favRef = db.collection('users').doc(fav.odUserId).collection('favorites').doc(fav.odTargetUserId);
      batch.set(favRef, {
        odTargetUserId: fav.odTargetUserId,
        createdAt: fav.createdAt,
      });

      // Also store in target's "favoritedBy" subcollection for "who favorited me" queries
      const favByRef = db.collection('users').doc(fav.odTargetUserId).collection('favoritedBy').doc(fav.odUserId);
      batch.set(favByRef, {
        odUserId: fav.odUserId,
        createdAt: fav.createdAt,
      });
    }
    
    await batch.commit();
    totalCreated += batchFavorites.length;
  }

  console.log(`  ✓ Created ${totalCreated} favorites (and favoritedBy references)`);
}

async function seedProfileViews(
  db: FirebaseFirestore.Firestore,
  views: { odId: string; odViewerId: string; odViewedUserId: string; viewedAt: Date }[]
) {
  const batchSize = 500;
  let totalCreated = 0;

  for (let i = 0; i < views.length; i += batchSize) {
    const batch = db.batch();
    const batchViews = views.slice(i, i + batchSize);

    for (const view of batchViews) {
      // Store in viewer's "viewed" subcollection (profiles I've viewed)
      const viewedRef = db.collection('users').doc(view.odViewerId).collection('viewed').doc(view.odViewedUserId);
      batch.set(viewedRef, {
        odViewedUserId: view.odViewedUserId,
        viewedAt: view.viewedAt,
      });

      // Store in viewed user's "viewedBy" subcollection (who viewed me)
      const viewedByRef = db.collection('users').doc(view.odViewedUserId).collection('viewedBy').doc(view.odViewerId);
      batch.set(viewedByRef, {
        odViewerId: view.odViewerId,
        viewedAt: view.viewedAt,
      });
    }
    
    await batch.commit();
    totalCreated += batchViews.length;
  }

  console.log(`  ✓ Created ${totalCreated} profile views (and viewedBy references)`);
}

async function seedConversations(
  db: FirebaseFirestore.Firestore,
  conversations: { odId: string; odParticipants: string[]; lastMessageAt: Date; lastMessage: string; lastSenderId: string }[],
  messages: { odId: string; odConversationId: string; odSenderId: string; content: string; createdAt: Date; read: boolean }[]
) {
  // Seed conversations
  const batchSize = 500;
  let conversationsCreated = 0;

  for (let i = 0; i < conversations.length; i += batchSize) {
    const batch = db.batch();
    const batchConversations = conversations.slice(i, i + batchSize);

    for (const conv of batchConversations) {
      const convRef = db.collection('conversations').doc(conv.odId);
      batch.set(convRef, {
        participants: conv.odParticipants,
        lastMessageAt: conv.lastMessageAt,
        lastMessage: conv.lastMessage,
        lastSenderId: conv.lastSenderId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    
    await batch.commit();
    conversationsCreated += batchConversations.length;
  }

  console.log(`  ✓ Created ${conversationsCreated} conversations`);

  // Seed messages
  let messagesCreated = 0;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = db.batch();
    const batchMessages = messages.slice(i, i + batchSize);

    for (const msg of batchMessages) {
      const msgRef = db.collection('conversations').doc(msg.odConversationId).collection('messages').doc(msg.odId);
      batch.set(msgRef, {
        senderId: msg.odSenderId,
        content: msg.content,
        createdAt: msg.createdAt,
        read: msg.read,
      });
    }
    
    await batch.commit();
    messagesCreated += batchMessages.length;
  }

  console.log(`  ✓ Created ${messagesCreated} messages`);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function printLoginCredentials(users: SeedUser[]) {
  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST LOGIN CREDENTIALS');
  console.log('='.repeat(60));
  console.log('\nAll passwords: password123\n');
  console.log('Email                          | Name                    | Support');
  console.log('-'.repeat(60));
  
  // Show first 10 users
  const displayUsers = users.slice(0, 10);
  for (const user of displayUsers) {
    const email = user.email.padEnd(30);
    const name = user.displayName.padEnd(23);
    const support = user.onboarding.supportOrientation;
    console.log(`${email} | ${name} | ${support}`);
  }
  
  if (users.length > 10) {
    console.log(`... and ${users.length - 10} more users`);
  }
  
  console.log('='.repeat(60));
}

async function clearAuthUsers(auth: ReturnType<typeof getAuth>) {
  try {
    const listResult = await auth.listUsers(1000);
    if (listResult.users.length === 0) {
      console.log('  • auth: already empty');
      return;
    }
    
    const uids = listResult.users.map(u => u.uid);
    await auth.deleteUsers(uids);
    console.log(`  • auth: deleted ${uids.length} users`);
  } catch (error: any) {
    console.error('  • auth: error clearing users:', error.message);
  }
}

async function clearCollection(db: FirebaseFirestore.Firestore, collectionName: string) {
  const collectionRef = db.collection(collectionName);
  
  // Get all documents
  let totalDeleted = 0;
  let snapshot = await collectionRef.limit(500).get();
  
  while (!snapshot.empty) {
    const batch = db.batch();
    
    for (const doc of snapshot.docs) {
      // Clear subcollections
      const subcollections = await doc.ref.listCollections();
      for (const subcol of subcollections) {
        const subDocs = await subcol.limit(500).get();
        for (const subDoc of subDocs.docs) {
          batch.delete(subDoc.ref);
        }
      }
      batch.delete(doc.ref);
    }
    
    await batch.commit();
    totalDeleted += snapshot.size;
    
    // Get next batch
    snapshot = await collectionRef.limit(500).get();
  }
  
  if (totalDeleted > 0) {
    console.log(`  • ${collectionName}: deleted ${totalDeleted} documents`);
  } else {
    console.log(`  • ${collectionName}: already empty`);
  }
}

main().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
