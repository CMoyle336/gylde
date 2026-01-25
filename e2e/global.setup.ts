import * as fs from 'fs';
import * as path from 'path';

function generateRunId(): string {
  // short, filesystem-safe id
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function globalSetup() {
  const baseURL = process.env.BASE_URL || 'http://localhost:4200';
  const isLiveEnv = baseURL.includes('gylde.com');

  const tmpDir = path.resolve(__dirname, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const runId = generateRunId();
  const runIdPath = path.join(tmpDir, 'run-id.txt');
  const createdUsersPath = path.join(tmpDir, `created-users.${runId}.jsonl`);

  fs.writeFileSync(runIdPath, runId, 'utf8');
  fs.writeFileSync(createdUsersPath, '', 'utf8');

  console.log('🚀 Global Setup: E2E run initialized\n');
  console.log(`   Base URL: ${baseURL}`);
  console.log(`   Environment: ${isLiveEnv ? 'LIVE' : 'LOCAL EMULATOR'}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   Registry: ${createdUsersPath}\n`);
}

export default globalSetup;
