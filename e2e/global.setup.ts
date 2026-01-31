import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Ensure .env is loaded from the e2e directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

function generateRunId(): string {
  // short, filesystem-safe id
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function globalSetup() {
  const baseURL = process.env.BASE_URL || 'http://localhost:4200';
  const isLiveEnv = baseURL.includes('gylde.com');
  const provisioningStrategy = process.env.E2E_PROVISIONING_STRATEGY || 'admin';
  const loginStrategy = process.env.E2E_LOGIN_STRATEGY || 'ui';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'gylde-sandbox';
  const hasCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
  console.log(`   Registry: ${createdUsersPath}`);
  console.log('');
  console.log('📋 Authentication Configuration:');
  console.log(`   Provisioning Strategy: ${provisioningStrategy}`);
  console.log(`   Login Strategy: ${loginStrategy}`);
  console.log(`   Firebase Project ID: ${projectId}`);
  console.log(`   Admin Credentials: ${hasCredentials ? '✓ Available' : '✗ Not set'}`);
  if (hasCredentials) {
    console.log(`   Credentials Path: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  }
  console.log('');
  
  if (isLiveEnv && !hasCredentials) {
    console.warn('⚠️  WARNING: Running against live environment without admin credentials!');
    console.warn('   Users will be created via UI (subject to Firebase rate limits).');
    console.warn('   Set GOOGLE_APPLICATION_CREDENTIALS in e2e/.env to use admin provisioning.\n');
  }
}

export default globalSetup;
