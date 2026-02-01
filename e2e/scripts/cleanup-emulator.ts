/**
 * Script to clean up all test data from local emulators
 * 
 * Usage: npx ts-node scripts/cleanup-emulator.ts
 */

const FIRESTORE_EMULATOR_URL = 'http://localhost:8080';
const AUTH_EMULATOR_URL = 'http://localhost:9099';
const PROJECT_ID = 'gylde-sandbox';

async function clearFirestoreEmulator(): Promise<void> {
  console.log('🗑️  Clearing Firestore emulator data...');
  
  const url = `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  
  const resp = await fetch(url, {
    method: 'DELETE',
  });
  
  if (resp.ok) {
    console.log('   ✅ Firestore data cleared');
  } else {
    console.log(`   ⚠️  Failed to clear Firestore: ${resp.status} ${resp.statusText}`);
  }
}

async function clearAuthEmulator(): Promise<void> {
  console.log('🗑️  Clearing Auth emulator data...');
  
  const url = `${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  
  const resp = await fetch(url, {
    method: 'DELETE',
  });
  
  if (resp.ok) {
    console.log('   ✅ Auth data cleared');
  } else {
    console.log(`   ⚠️  Failed to clear Auth: ${resp.status} ${resp.statusText}`);
  }
}

async function main() {
  console.log('\n🧹 Cleaning up Firebase emulators...\n');
  
  try {
    await clearFirestoreEmulator();
    await clearAuthEmulator();
    console.log('\n✅ Emulator cleanup complete!\n');
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    console.log('\n   Make sure the emulators are running.');
    process.exit(1);
  }
}

main();
