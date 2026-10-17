#!/usr/bin/env tsx
/**
 * CLI Database Backup Script
 * Generates an encrypted/checksummed snapshot of all relational and vector data.
 * Usage:
 *   npx tsx scripts/backup-db.ts [--output <filePath>]
 */

import fs from 'fs';
import path from 'path';
import { exportDatabaseBackup } from '../server/services/db_backup_service.js';

async function main() {
  const args = process.argv.slice(2);
  let outputPath: string | null = null;
  const outIdx = args.indexOf('--output');
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputPath = args[outIdx + 1];
  }

  const defaultDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetFile = outputPath || path.join(defaultDir, `db_backup_${timestamp}.json`);

  console.log('=====================================================');
  console.log('  Studio Lumina — Database Backup Utility');
  console.log(`  Destination: ${targetFile}`);
  console.log('=====================================================\n');

  try {
    const backupBundle = exportDatabaseBackup();

    fs.writeFileSync(targetFile, JSON.stringify(backupBundle, null, 2), 'utf-8');

    console.log('✓ Backup generated successfully:');
    console.log(`   - Timestamp:       ${backupBundle.timestamp}`);
    console.log(`   - SHA-256 Hash:    ${backupBundle.sha256}`);
    for (const [tbl, count] of Object.entries(backupBundle.recordCounts)) {
      console.log(`   - ${tbl.padEnd(18)}: ${count}`);
    }
    console.log(`   - File Size:       ${(fs.statSync(targetFile).size / 1024).toFixed(2)} KB\n`);
    console.log(`✅ Backup file saved to: ${targetFile}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Backup generation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
