import * as fs from 'fs';
import * as path from 'path';
import { getAdminAuth } from './tests/utils/settings-helpers';

type RegistryEntry = {
  uid: string;
  email: string;
  createdAt: string;
};

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

  // Local emulator
  const maxConcurrent = 25;
  let idx = 0;
  const worker = async () => {
    while (idx < users.length) {
      const current = users[idx++];
      await deleteUserFromAuthEmulator(current.uid).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, users.length) }, () => worker()));
  console.log(`✅ Deleted ${users.length} users via Auth emulator\n`);
}

export default globalTeardown;
