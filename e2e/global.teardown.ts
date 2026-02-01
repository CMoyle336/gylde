import * as fs from 'fs';
import * as path from 'path';
import { getAdminAuth } from './tests/utils/settings-helpers';

type RegistryEntry = {
  uid: string;
  email: string;
  createdAt: string;
};

const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
const PROJECT_ID = 'gylde-sandbox';

function isLiveEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
  return baseUrl.includes('gylde.com');
}

async function deleteUserFromAuthEmulator(uid: string): Promise<boolean> {
  // Auth emulator supports the Identity Toolkit REST API surface.
  const authEmulatorUrl = 'http://localhost:9099';
  const url = `${authEmulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:delete?key=fake-key`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  }).catch(() => null);

  return !!resp && resp.ok;
}

/**
 * Delete a document and its subcollections from Firestore emulator
 */
async function deleteDocumentRecursive(docPath: string): Promise<void> {
  const url = `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer owner' },
  }).catch(() => {});
}

/**
 * List and delete all documents in a collection for the emulator
 */
async function deleteCollectionDocs(collectionPath: string): Promise<number> {
  const url = `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}`;
  
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer owner' },
    });
    
    if (!resp.ok) return 0;
    
    const data = await resp.json();
    const docs = data.documents || [];
    
    for (const doc of docs) {
      // Extract document path from full name
      const fullName = doc.name as string;
      const docPath = fullName.split('/documents/')[1];
      if (docPath) {
        await deleteDocumentRecursive(docPath);
      }
    }
    
    return docs.length;
  } catch {
    return 0;
  }
}

/**
 * Clean up all Firestore data for a user (emulator only)
 */
async function cleanupUserFirestoreData(uid: string): Promise<void> {
  // Delete main user document
  await deleteDocumentRecursive(`users/${uid}`);
  
  // Delete user's subcollections
  const subcollections = [
    `users/${uid}/feedItems`,
    `users/${uid}/favorites`,
    `users/${uid}/notifications`,
    `users/${uid}/activity`,
    `users/${uid}/blockedUsers`,
    `users/${uid}/blockedByUsers`,
    `users/${uid}/privateAccess`,
    `users/${uid}/privateAccessRequests`,
  ];
  
  for (const collection of subcollections) {
    await deleteCollectionDocs(collection);
  }
}

/**
 * Clean up posts created by test users
 */
async function cleanupTestPosts(uids: string[]): Promise<number> {
  let deletedCount = 0;
  
  for (const uid of uids) {
    // Query posts by this author
    const url = `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 
          'Authorization': 'Bearer owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'posts' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'authorId' },
                op: 'EQUAL',
                value: { stringValue: uid },
              },
            },
          },
        }),
      });
      
      if (!resp.ok) continue;
      
      const results = await resp.json();
      
      for (const result of results) {
        if (result.document) {
          const fullName = result.document.name as string;
          const docPath = fullName.split('/documents/')[1];
          if (docPath) {
            // Delete post's subcollections (comments, likes)
            await deleteCollectionDocs(`${docPath}/comments`);
            await deleteCollectionDocs(`${docPath}/likes`);
            await deleteDocumentRecursive(docPath);
            deletedCount++;
          }
        }
      }
    } catch {
      // Best effort
    }
  }
  
  return deletedCount;
}

async function globalTeardown() {
  const tmpDir = path.resolve(__dirname, '.tmp');
  const runIdPath = path.join(tmpDir, 'run-id.txt');
  if (!fs.existsSync(runIdPath)) {
    return;
  }

  const runId = fs.readFileSync(runIdPath, 'utf8').trim();
  if (!runId) return;

  const registryPath = path.join(tmpDir, `created-users.${runId}.jsonl`);
  if (!fs.existsSync(registryPath)) {
    return;
  }

  const raw = fs.readFileSync(registryPath, 'utf8');
  const entries: RegistryEntry[] = raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RegistryEntry;
      } catch {
        return null;
      }
    })
    .filter((v): v is RegistryEntry => !!v && !!v.uid);

  // Deduplicate by UID
  const uniqueByUid = new Map<string, RegistryEntry>();
  for (const e of entries) uniqueByUid.set(e.uid, e);
  const users = [...uniqueByUid.values()];

  console.log('\n🧹 Global Teardown: Cleaning up per-test users...\n');
  console.log(`   Run ID: ${runId}`);
  console.log(`   Users recorded: ${entries.length} (unique: ${users.length})\n`);

  if (users.length === 0) return;

  const isLive = isLiveEnvironment();

  if (isLive) {
    const adminAuth = await getAdminAuth();
    if (!adminAuth) {
      console.log('   ⚠ Admin Auth unavailable; skipping user cleanup.\n');
      return;
    }

    const maxConcurrent = 10;
    let idx = 0;
    const worker = async () => {
      while (idx < users.length) {
        const current = users[idx++];
        try {
          await adminAuth.deleteUser(current.uid);
        } catch {
          // best-effort
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(maxConcurrent, users.length) }, () => worker()));
    console.log(`✅ Deleted ${users.length} users via Admin Auth\n`);
    return;
  }

  // Local emulator - clean up both Auth and Firestore
  const uids = users.map(u => u.uid);
  
  // Clean up Firestore data first (posts, user docs, subcollections)
  console.log('   Cleaning up Firestore data...');
  const postsDeleted = await cleanupTestPosts(uids);
  if (postsDeleted > 0) {
    console.log(`   - Deleted ${postsDeleted} posts`);
  }
  
  // Clean up user documents and subcollections
  const maxConcurrent = 10;
  let idx = 0;
  const firestoreWorker = async () => {
    while (idx < users.length) {
      const current = users[idx++];
      await cleanupUserFirestoreData(current.uid);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, users.length) }, () => firestoreWorker()));
  console.log(`   - Deleted ${users.length} user documents`);
  
  // Then clean up Auth users
  idx = 0;
  const authWorker = async () => {
    while (idx < users.length) {
      const current = users[idx++];
      await deleteUserFromAuthEmulator(current.uid).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(25, users.length) }, () => authWorker()));
  
  console.log(`\n✅ Cleaned up ${users.length} users (Auth + Firestore)\n`);
}

export default globalTeardown;
