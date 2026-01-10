/**
 * Firestore Seed Script
 * 
 * Populates the Firestore emulator with sample data for development.
 * 
 * Usage:
 *   npm run seed
 *   npm run seed -- --clear  (clear existing data first)
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sampleUsers, SeedUser } from './seed-data/users';

// Configuration
const FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'gylde-dba55';

// Check if we should clear existing data
const shouldClear = process.argv.includes('--clear');

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
  console.log(`📁 Project: ${PROJECT_ID}\n`);

  if (shouldClear) {
    console.log('🗑️  Clearing existing data...');
    await clearAuthUsers(auth);
    await clearCollection(db, 'users');
    await clearCollection(db, 'matches');
    console.log('✅ Data cleared\n');
  }

  // Seed auth users
  console.log('🔐 Creating Auth users...');
  await seedAuthUsers(auth);

  // Seed Firestore users
  console.log('\n👥 Seeding Firestore profiles...');
  await seedFirestoreUsers(db);
  
  console.log('\n🎉 Seeding complete!');
  console.log('\n' + '='.repeat(50));
  console.log('📋 TEST LOGIN CREDENTIALS');
  console.log('='.repeat(50));
  console.log('\nAll passwords: password123\n');
  console.log('Email                  | Name');
  console.log('-'.repeat(50));
  for (const user of sampleUsers) {
    console.log(`${user.email.padEnd(22)} | ${user.displayName}`);
  }
  console.log('='.repeat(50));
  
  process.exit(0);
}

async function seedAuthUsers(auth: ReturnType<typeof getAuth>) {
  for (const user of sampleUsers) {
    try {
      await auth.createUser({
        uid: user.uid,
        email: user.email,
        password: user.password,
        displayName: user.displayName,
        photoURL: user.photoURL || undefined,
        emailVerified: true,
      });
      console.log(`  ✓ ${user.email}`);
    } catch (error: any) {
      if (error.code === 'auth/uid-already-exists' || error.code === 'auth/email-already-exists') {
        console.log(`  ⏭️  ${user.email} (already exists)`);
      } else {
        console.error(`  ✗ ${user.email}: ${error.message}`);
      }
    }
  }
  console.log(`\n✅ Auth users ready`);
}

async function seedFirestoreUsers(db: FirebaseFirestore.Firestore) {
  const batch = db.batch();
  
  for (const user of sampleUsers) {
    const userRef = db.collection('users').doc(user.uid);
    
    // Generate a random lastActiveAt within the last 7 days
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const randomLastActive = new Date(sevenDaysAgo + Math.random() * (now - sevenDaysAgo));
    
    batch.set(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastActiveAt: randomLastActive,
      onboardingCompleted: user.onboardingCompleted,
      onboarding: user.onboarding,
    });
    
    const activeAgo = getTimeAgo(randomLastActive);
    console.log(`  ✓ ${user.displayName} (${user.onboarding.city}) - active ${activeAgo}`);
  }
  
  await batch.commit();
  console.log(`\n✅ Created ${sampleUsers.length} Firestore profiles`);
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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
  const snapshot = await collectionRef.limit(500).get();
  
  if (snapshot.empty) {
    console.log(`  • ${collectionName}: already empty`);
    return;
  }
  
  const batch = db.batch();
  
  for (const doc of snapshot.docs) {
    // Also clear subcollections
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
  console.log(`  • ${collectionName}: deleted ${snapshot.size} documents`);
}

main().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
