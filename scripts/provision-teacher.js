#!/usr/bin/env node
/**
 * Teacher Account Provisioning Script
 * =====================================
 * Creates a verified teacher account directly in the database.
 * This is the ONLY safe way to provision teacher accounts.
 * The sign-up form is intentionally disabled from self-granting teacher roles
 * (see note in auth.js about role validation).
 *
 * Usage:
 *   node scripts/provision-teacher.js --email ravi@iiitdwd.ac.in --password "Str0ng!Pass"
 *
 * Options:
 *   --email     Required. Must end with @iiitdwd.ac.in
 *   --password  Required. Must meet strength policy.
 *   --username  Optional. Defaults to email prefix.
 *   --dry-run   Optional. Validates inputs without writing to DB.
 */

const path = require('path');
// Add server's node_modules to module resolution path
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Parse CLI args
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const dryRun = args.includes('--dry-run');
const email = get('--email');
const password = get('--password');
const usernameArg = get('--username');

// Validation
if (!email || !password) {
  console.error('❌  --email and --password are required.');
  console.error('Usage: node scripts/provision-teacher.js --email ravi@iiitdwd.ac.in --password "Str0ng!Pass"');
  process.exit(1);
}

const ALLOWED_DOMAIN = '@iiitdwd.ac.in';
if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
  console.error(`❌  Only ${ALLOWED_DOMAIN} emails are allowed.`);
  process.exit(1);
}

function isStrongPassword(pw) {
  return pw.length >= 8 &&
    /[A-Z]/.test(pw) && /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw);
}

if (!isStrongPassword(password)) {
  console.error('❌  Password must be ≥8 chars with uppercase, lowercase, number, and special character.');
  process.exit(1);
}

const username = (usernameArg || email.split('@')[0]).toLowerCase();

if (dryRun) {
  console.log('✅  Dry run — inputs valid:');
  console.log(`    Email:    ${email.toLowerCase()}`);
  console.log(`    Username: ${username}`);
  console.log(`    Role:     teacher`);
  console.log(`    Verified: true`);
  console.log('    (No database write performed)');
  process.exit(0);
}

// Connect and provision
async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌  MONGO_URI not set in .env');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅  Connected.');

  // Load model after connect
  const User = require(path.resolve(__dirname, '../server/models/User'));

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    existing.role = 'teacher';
    existing.isVerified = true;
    existing.password = password;
    if (usernameArg) existing.username = username;
    await existing.save();
    console.log(`✅  ${existing.email} is now a verified teacher with updated credentials.`);
  } else {
    // Hash password (User model pre-save also hashes, so we create via User.create)
    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password,
      role: 'teacher',
      isVerified: true
    });
    console.log(`✅  Teacher account created:`);
    console.log(`    ID:       ${user._id}`);
    console.log(`    Email:    ${user.email}`);
    console.log(`    Username: ${user.username}`);
    console.log(`    Role:     ${user.role}`);
    console.log(`    Verified: ${user.isVerified}`);
  }

  await mongoose.disconnect();
  console.log('🔌  Disconnected. Done.');
}

run().catch((err) => {
  console.error('❌  Provisioning failed:', err.message);
  process.exit(1);
});
