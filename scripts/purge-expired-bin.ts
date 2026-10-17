#!/usr/bin/env tsx
/**
 * Standalone Scheduled Cron Runner: Recycle Bin Expired Events Purge
 * 
 * Usage:
 *   npx tsx scripts/purge-expired-bin.ts
 * 
 * Suitable for:
 * - Linux Crontab (e.g. 0 * * * * cd /app && npm run bin:purge)
 * - Kubernetes CronJob
 * - Systemd timer
 */
import { reconcileExpiredBinEvents } from '../apps/api/src/services/recycleBinService.js';
import { closeDatabase } from '../apps/api/src/infrastructure/database.js';

async function main() {
  console.log(`\n========================================`);
  console.log(`  Studio Lumina — Recycle Bin Purge Cron`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================\n`);

  try {
    const { claimedCount, purgedCount } = await reconcileExpiredBinEvents();
    console.log(`✓ Purge cycle completed.`);
    console.log(`   - Eligible events claimed: ${claimedCount}`);
    console.log(`   - Successfully purged:     ${purgedCount}`);
  } catch (err) {
    console.error(`✗ Error executing Recycle Bin purge:`, err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();
