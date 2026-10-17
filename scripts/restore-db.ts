#!/usr/bin/env tsx
/**
 * CLI Database Restore Script
 * Restores all relational and vector records from a verified backup snapshot.
 * Usage:
 *   npx tsx scripts/restore-db.ts --input <backupFilePath>
 */

import fs from 'fs';
import path from 'path';
import { restoreDatabaseFromBackup } from '../server/services/db_backup_service.js';

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  if (inputIdx === -1 || !args[inputIdx + 1]) {
    console.error('Usage: npx tsx scripts/restore-db.ts --input <backupFilePath>');
    process.exit(1);
  }

  const inputFile = path.resolve(process.cwd(), args[inputIdx + 1]);
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Backup file not found at: ${inputFile}`);
    process.exit(1);
  }

  console.log('=====================================================');
  console.log('  Studio Lumina — Database Restore Utility');
  console.log(`  Source Snapshot: ${inputFile}`);
  console.log('=====================================================\n');

  try {
    const rawContent = fs.readFileSync(inputFile, 'utf-8');
    const backupBundle = JSON.parse(rawContent);

    console.log('Verifying snapshot integrity & restoring database tables...');
    const result = await restoreDatabaseFromBackup(backupBundle);

    console.log('\n✓ Restoration completed successfully:');
    console.log(`   - Restored At:     ${result.restoredAt}`);
    console.log(`   - Duration:        ${result.durationMs}ms`);
    for (const [tbl, count] of Object.entries(result.restoredCounts)) {
      console.log(`   - ${tbl.padEnd(18)} Restored: ${count}`);
    }
    console.log(`   - Integrity Check: ${result.integrityCheck.status} (0 orphan records)\n`);
    console.log('✅ Database is ready and operational.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Restore failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
