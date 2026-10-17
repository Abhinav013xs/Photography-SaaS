#!/usr/bin/env tsx
/**
 * CLI Migration Runner
 * Usage:
 *   npx tsx scripts/migrate.ts [up|down|status|reset]
 */
import {
  migrateUp,
  migrateDown,
  getMigrationStatus,
  migrateReset,
} from '../apps/api/src/infrastructure/migrator.js';
import { closeDatabase } from '../apps/api/src/infrastructure/database.js';

const command = process.argv[2] || 'up';

async function main() {
  console.log(`\n========================================`);
  console.log(`  Studio Lumina — Database Migrator`);
  console.log(`  Command: ${command}`);
  console.log(`========================================\n`);

  try {
    switch (command) {
      case 'up': {
        const applied = await migrateUp();
        if (applied.length === 0) {
          console.log('✓ Database schema is already up to date. No pending migrations.');
        } else {
          console.log(`✓ Successfully applied ${applied.length} migration(s):`);
          applied.forEach((m) => console.log(`   + ${m}`));
        }
        break;
      }

      case 'down': {
        const rolledBack = await migrateDown();
        if (!rolledBack) {
          console.log('✓ No applied migrations to roll back.');
        } else {
          console.log(`✓ Successfully rolled back migration: ${rolledBack}`);
        }
        break;
      }

      case 'status': {
        const statuses = await getMigrationStatus();
        console.log('Migration Status:');
        console.table(
          statuses.map((s) => ({
            Migration: s.name,
            Applied: s.applied ? 'YES' : 'PENDING',
            'Applied At': s.appliedAt ? s.appliedAt.toISOString() : '—',
          }))
        );
        break;
      }

      case 'reset': {
        console.log('Resetting database schema...');
        const result = await migrateReset();
        console.log(`✓ Rolled back ${result.rolledBack.length} migration(s).`);
        console.log(`✓ Reapplied ${result.reapplied.length} migration(s).`);
        break;
      }

      default:
        console.error(`Unknown command: "${command}". Available commands: up, down, status, reset`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('\n❌ Migration error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();
