/**
 * Diagnostic script for 403 Google SDM API error
 * Run this to get detailed error information
 */

const axios = require('axios');
require('dotenv').config();

async function diagnose() {
  console.log('\n🔍 Diagnosing 403 Error...\n');
  
  // Check environment variables
  console.log('✓ Environment Variables:');
  console.log(`  GOOGLE_PROJECT_ID: ${process.env.GOOGLE_PROJECT_ID ? '✓ Set' : '✗ Missing'}`);
  console.log(`  GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing'}`);
  console.log(`  GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing'}`);
  
  // Test with a fresh OAuth flow (you'll need to get a token manually)
  console.log('\n📝 Next Steps:\n');
  console.log('1. The 403 error typically means one of the following:');
  console.log('   a) Access token expired - Need to refresh token');
  console.log('   b) OAuth consent screen not verified');
  console.log('   c) API not enabled in Google Cloud Console');
  console.log('   d) Incorrect OAuth scopes');
  console.log('   e) T6 Pro device not registered with Google SDM\n');
  
  console.log('2. Verify Google Cloud Console setup:');
  console.log('   → https://console.cloud.google.com/apis/dashboard');
  console.log('   → Check if "Smart Device Management API" is enabled');
  console.log('   → Check OAuth consent screen status\n');
  
  console.log('3. Check Device Access Console:');
  console.log('   → https://console.nest.google.com/device-access/');
  console.log('   → Verify your project is active');
  console.log('   → Check which devices are registered\n');
  
  console.log('4. Common 403 Causes:');
  console.log('   • Token expired: Re-authenticate in the app');
  console.log('   • T6 Pro not in SDM: Device must be explicitly added to SDM project');
  console.log('   • API disabled: Enable "Smart Device Management API" in GCP');
  console.log('   • Wrong project: Verify project ID matches Device Access Console\n');
  
  console.log('5. T6 Pro Specific Issue:');
  console.log('   ⚠️  Your T6 Pro works with Google Home but NOT with SDM API');
  console.log('   → Google Home uses a different API than Smart Device Management');
  console.log('   → You need to explicitly register the T6 Pro in Device Access Console');
  console.log('   → Go to: https://console.nest.google.com/device-access/project-list');
  console.log('   → Select your project');
  console.log('   → Check if T6 Pro is listed in authorized devices\n');
  
  console.log('6. Quick Fix:');
  console.log('   → Sign out and sign in again in the web app');
  console.log('   → This will force a fresh OAuth token\n');
}

diagnose().catch(console.error);

