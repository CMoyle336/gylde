#!/usr/bin/env node
/**
 * Build script that reads NG_BUILD_CONFIG from environment
 * and runs ng build with the appropriate configuration.
 */
const { execSync } = require('child_process');

const config = process.env.NG_BUILD_CONFIG || 'production';
console.log(`\n=== Building Angular with configuration: ${config} ===\n`);

try {
  execSync(`npx ng build --configuration=${config}`, { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
} catch (error) {
  process.exit(error.status || 1);
}
