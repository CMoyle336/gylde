/**
 * Clean Preview Environment Script
 * 
 * Deletes ALL users and data from the preview Firebase environment (gylde-sandbox).
 * 
 * CAUTION: This is destructive and cannot be undone!
 * 
 * Prerequisites:
 *   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
 *   2. Login with quota project:
 *      gcloud auth application-default login --project gylde-sandbox
 *   3. Set quota project for ADC:
 *      gcloud auth application-default set-quota-project gylde-sandbox
 * 
 * Usage:
 *   npx tsx clean-preview.ts              # Dry run (shows what would be deleted)
 *   npx tsx clean-preview.ts --confirm    # Actually delete everything
 *   npx tsx clean-preview.ts --confirm --skip-storage  # Skip storage (if bucket doesn't exist)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

// Preview environment project ID
const PROJECT_ID = 'gylde-sandbox';

// Parse command line arguments
const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const skipUsers = args.includes('--skip-users');
const skipData = args.includes('--skip-data');
const skipStorage = args.includes('--skip-storage');

// Collections to delete
const COLLECTIONS_TO_DELETE = [
  'users',
  'conversations', 
  'matches',
  'profileViews',
  'activities',
  'favorites',
  'blocks',
  'reports',
  'photoAccessRequests',
  'subscriptions',
  'founders',
];

async function main() {
  console.log('🧹 Clean Preview Environment Script');
  console.log('====================================\n');
  console.log(`📁 Project: ${PROJECT_ID}`);
  console.log(`🔥 Mode: ${confirmed ? '⚠️  DESTRUCTIVE - WILL DELETE DATA' : '👀 DRY RUN (use --confirm to delete)'}\n`);

  if (!confirmed) {
    console.log('⚠️  This is a DRY RUN. No data will be deleted.');
    console.log('   Run with --confirm to actually delete data.\n');
  }

  // Initialize Firebase Admin with application default credentials
  try {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin.');
    console.error('   Make sure you have run:');
    console.error('     gcloud auth application-default login --project gylde-sandbox');
    console.error('     gcloud auth application-default set-quota-project gylde-sandbox\n');
    console.error(error);
    process.exit(1);
  }

  const db = getFirestore();
  const auth = getAuth();
  const storage = getStorage();

  console.log('✅ Connected to Firebase\n');

  // Count and delete Auth users
  if (!skipUsers) {
    console.log('👥 Processing Auth Users...');
    await processAuthUsers(auth, confirmed);
  }

  // Count and delete Firestore collections
  if (!skipData) {
    console.log('\n📚 Processing Firestore Collections...');
    for (const collection of COLLECTIONS_TO_DELETE) {
      await processCollection(db, collection, confirmed);
    }
  }

  // Delete Storage files
  if (!skipStorage) {
    console.log('\n🗄️  Processing Storage...');
    await processStorage(storage, confirmed);
  }

  console.log('\n✅ Done!');
  if (!confirmed) {
    console.log('\n💡 To actually delete, run: npx tsx clean-preview.ts --confirm');
  }
}

async function processAuthUsers(auth: ReturnType<typeof getAuth>, confirmed: boolean) {
  try {
    let totalUsers = 0;
    let pageToken: string | undefined;

    do {
      const listResult = await auth.listUsers(1000, pageToken);
      totalUsers += listResult.users.length;

      if (confirmed && listResult.users.length > 0) {
        const uids = listResult.users.map(user => user.uid);
        await auth.deleteUsers(uids);
        console.log(`   🗑️  Deleted ${uids.length} users`);
      }

      pageToken = listResult.pageToken;
    } while (pageToken);

    if (confirmed) {
      console.log(`   ✅ Deleted ${totalUsers} total users`);
    } else {
      console.log(`   📊 Found ${totalUsers} users (would be deleted)`);
    }
  } catch (error: any) {
    if (error?.code === 'auth/internal-error' && error?.message?.includes('quota')) {
      console.error('   ❌ Auth error: Quota project not set.');
      console.error('      Run: gcloud auth application-default set-quota-project gylde-sandbox');
    } else {
      console.error('   ❌ Error processing auth users:', error?.message || error);
    }
  }
}

async function processCollection(db: ReturnType<typeof getFirestore>, collectionName: string, confirmed: boolean) {
  try {
    const collectionRef = db.collection(collectionName);
    const snapshot = await collectionRef.limit(1).get();
    
    if (snapshot.empty) {
      console.log(`   📁 ${collectionName}: empty`);
      return;
    }

    // Count documents
    const countSnapshot = await collectionRef.count().get();
    const count = countSnapshot.data().count;

    if (confirmed) {
      await deleteCollection(db, collectionName);
      console.log(`   🗑️  ${collectionName}: deleted ${count} documents`);
    } else {
      console.log(`   📁 ${collectionName}: ${count} documents (would be deleted)`);
    }
  } catch (error) {
    console.error(`   ❌ Error processing ${collectionName}:`, error);
  }
}

async function deleteCollection(db: ReturnType<typeof getFirestore>, collectionName: string) {
  const collectionRef = db.collection(collectionName);
  const batchSize = 500;

  const query = collectionRef.limit(batchSize);

  return new Promise<void>((resolve, reject) => {
    deleteQueryBatch(db, query, batchSize, resolve, reject);
  });
}

async function deleteQueryBatch(
  db: ReturnType<typeof getFirestore>,
  query: FirebaseFirestore.Query,
  batchSize: number,
  resolve: () => void,
  reject: (error: Error) => void
) {
  try {
    const snapshot = await query.get();

    if (snapshot.size === 0) {
      resolve();
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    // Recurse for next batch
    process.nextTick(() => {
      deleteQueryBatch(db, query, batchSize, resolve, reject);
    });
  } catch (error) {
    reject(error as Error);
  }
}

async function processStorage(storage: ReturnType<typeof getStorage>, confirmed: boolean) {
  // Try common Firebase Storage bucket naming conventions
  const bucketNames = [
    `${PROJECT_ID}.appspot.com`,
    `${PROJECT_ID}.firebasestorage.app`,
    PROJECT_ID,
  ];

  for (const bucketName of bucketNames) {
    try {
      const bucket = storage.bucket(bucketName);
      const [exists] = await bucket.exists();
      
      if (!exists) {
        continue;
      }

      const [files] = await bucket.getFiles({ maxResults: 1000 });

      if (files.length === 0) {
        console.log(`   🗄️  Storage (${bucketName}): empty`);
        return;
      }

      if (confirmed) {
        for (const file of files) {
          await file.delete();
        }
        console.log(`   🗑️  Storage (${bucketName}): deleted ${files.length} files`);
        
        // Check if there are more files
        const [moreFiles] = await bucket.getFiles({ maxResults: 1 });
        if (moreFiles.length > 0) {
          console.log('   ⚠️  More files exist, run again to delete all');
        }
      } else {
        console.log(`   🗄️  Storage (${bucketName}): ${files.length}+ files (would be deleted)`);
      }
      return;
    } catch (error: any) {
      // Continue to next bucket name if this one doesn't exist
      if (error?.code === 404) {
        continue;
      }
      throw error;
    }
  }

  console.log('   ⚠️  No storage bucket found (tried: ' + bucketNames.join(', ') + ')');
}

main().catch(console.error);
