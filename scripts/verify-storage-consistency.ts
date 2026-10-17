#!/usr/bin/env tsx
/**
 * CLI Storage Consistency Verification Tool
 * Audits database media records against Cloudflare R2 / local storage.
 * Usage:
 *   npx tsx scripts/verify-storage-consistency.ts [--event <eventId>]
 */

import { runConsistencyAudit } from '../server/services/consistency_checker.js';

async function main() {
  const args = process.argv.slice(2);
  let eventId: string | null = null;
  const eventIdx = args.indexOf('--event');
  if (eventIdx !== -1 && args[eventIdx + 1]) {
    eventId = args[eventIdx + 1];
  }

  console.log('=====================================================');
  console.log('  Studio Lumina — Storage & Database Consistency Audit');
  if (eventId) {
    console.log(`  Target Event: ${eventId}`);
  } else {
    console.log('  Scope: Global Database & Storage Inspection');
  }
  console.log('=====================================================\n');

  try {
    const report = await runConsistencyAudit({ eventId: eventId || undefined });

    console.log(`Audit Timestamp: ${report.timestamp}`);
    console.log(`Total Media Records Audited: ${report.summary.totalMediaRecordsAudited}`);
    console.log(`Total Storage Objects Found: ${report.summary.totalStorageKeysAudited}`);
    console.log(`Missing Storage Objects:     ${report.summary.missingObjectCount}`);
    console.log(`Orphaned Storage Objects:    ${report.summary.orphanedObjectCount}\n`);

    if (report.missingInStorage.length > 0) {
      console.warn('⚠️  CRITICAL: Missing Objects in Storage (DB records exist but files are missing):');
      report.missingInStorage.forEach((m: any) => {
        console.warn(`   - Media ${m.mediaId} (${m.derivativeType}): ${m.storageKey}`);
      });
      console.log('');
    }

    if (report.orphanedInStorage.length > 0) {
      console.warn('ℹ️  Orphaned Objects in Storage (Files exist with no DB reference):');
      report.orphanedInStorage.slice(0, 20).forEach((key: string) => {
        console.warn(`   - ${key}`);
      });
      if (report.orphanedInStorage.length > 20) {
        console.warn(`   ... and ${report.orphanedInStorage.length - 20} more.`);
      }
      console.log('');
    }

    if (report.isConsistent) {
      console.log('✅ Storage and database are 100% consistent. Zero missing or orphaned objects.');
      process.exit(0);
    } else {
      console.log('⚠️  Inconsistencies detected. Review the above report.');
      process.exit(report.summary.missingObjectCount > 0 ? 1 : 0);
    }
  } catch (error) {
    console.error('❌ Consistency audit failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
