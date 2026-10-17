#!/usr/bin/env node
/**
 * CLI Utility to set or reset Photographer Login Credentials
 * Usage:
 *   node scripts/set-credentials.js <email> <password>
 * Example:
 *   node scripts/set-credentials.js mystudio@example.com MySecurePassword123
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'photographer.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const args = process.argv.slice(2);
const email = args[0]?.trim();
const password = args[1]?.trim();

console.log('=======================================================');
console.log('  Studio Lumina — Photographer Credentials Manager');
console.log('=======================================================');

if (!email || !password) {
  console.log('\nUsage:');
  console.log('  node scripts/set-credentials.js <email> <password>');
  console.log('\nExample:');
  console.log('  node scripts/set-credentials.js photographer@mygallery.com MySecretPass123\n');
  process.exit(1);
}

if (!email.includes('@') || !email.includes('.')) {
  console.error('\n❌ Error: Please provide a valid email address.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('\n❌ Error: Password must be at least 8 characters long.');
  process.exit(1);
}

try {
  const db = new Database(DB_PATH);
  
  // Create table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS photographer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      business_name TEXT DEFAULT 'Studio Lumina',
      tagline TEXT DEFAULT 'Editorial & Fine Art Photography',
      bio TEXT DEFAULT 'Documentary and fine art wedding photography.',
      website TEXT DEFAULT 'https://studiolumina.photo',
      instagram TEXT DEFAULT '@studiolumina',
      avatar_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  const normalizedEmail = email.toLowerCase().trim();

  const existing = db.prepare('SELECT id FROM photographer LIMIT 1').get();

  if (existing) {
    db.prepare('UPDATE photographer SET email = ?, password_hash = ? WHERE id = ?')
      .run(normalizedEmail, hash, existing.id);
    console.log(`\n✓ Successfully updated photographer login credentials:`);
  } else {
    db.prepare(`
      INSERT INTO photographer (email, password_hash, business_name, tagline, bio)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      normalizedEmail,
      hash,
      'Studio Lumina',
      'Editorial & Fine Art Photography',
      'Capturing raw human emotion and timeless celebrations across the world.'
    );
    console.log(`\n✓ Successfully created photographer login credentials:`);
  }

  console.log(`  Login Email : ${normalizedEmail}`);
  console.log(`  Password    : ${password}`);
  console.log('\nYou can now sign in at http://localhost:3000 with these credentials.\n');
  db.close();
} catch (err) {
  console.error('\n❌ Failed to update credentials:', err.message);
  process.exit(1);
}
