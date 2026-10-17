#!/usr/bin/env tsx
/**
 * CLI Development Database Seeder
 * Usage:
 *   npx tsx scripts/seed.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '@photography-saas/config';
import { getDatabasePool, closeDatabase } from '../apps/api/src/infrastructure/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_FILE = path.resolve(__dirname, '../infrastructure/database/seeds/dev_seed.sql');

async function seed() {
  const config = getConfig();

  console.log(`\n========================================`);
  console.log(`  Studio Lumina — Database Seeder`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`========================================\n`);

  if (config.nodeEnv === 'production') {
    console.error('❌ FATAL: Database seeding is strictly forbidden in production environments.');
    process.exit(1);
  }

  if (!fs.existsSync(SEED_FILE)) {
    console.error(`❌ Seed file not found at: ${SEED_FILE}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(SEED_FILE, 'utf-8');
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    console.log('Applying development seed data...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✓ Successfully seeded development database with isolated demo data.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await closeDatabase();
  }
}

seed();
