import db from '../db.js';
import storage from '../storage/r2.js';

/**
 * Runs periodically to check for:
 * 1. Events whose public window has expired -> automatically transitions visibility from 'public' to 'private'.
 * 2. Events in Recycle Bin whose retention has expired -> permanently purges storage and database records.
 */
export function startExpiryWorker(intervalMs = 60000) {
  const checkExpiredEvents = async () => {
    try {
      const now = new Date().toISOString();

      // 1. Check expired public viewing windows
      const expiredEvents = db.prepare(`
        SELECT id, name, public_until
        FROM events
        WHERE visibility = 'public'
          AND public_until IS NOT NULL
          AND public_until < ?
      `).all(now);

      if (expiredEvents.length > 0) {
        const updateStmt = db.prepare(`
          UPDATE events
          SET visibility = 'private', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);

        for (const ev of expiredEvents) {
          updateStmt.run(ev.id);
          console.log(`[Expiry Service] Event "${ev.name}" (${ev.id}) public duration reached (${ev.public_until}). Auto-transitioned to PRIVATE.`);
        }
      }

      // 2. Check expired Recycle Bin events
      const expiredBinEvents = db.prepare(`
        SELECT id, name, purge_after
        FROM events
        WHERE status = 'trashed'
          AND purge_after IS NOT NULL
          AND purge_after < ?
      `).all(now);

      if (expiredBinEvents.length > 0) {
        const purgeTx = db.transaction((eventId) => {
          db.prepare('DELETE FROM selection_revisions WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(eventId);
          db.prepare('DELETE FROM selection_items WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(eventId);
          db.prepare('DELETE FROM selection_collections WHERE event_id = ?').run(eventId);
          db.prepare('DELETE FROM processing_jobs WHERE event_id = ?').run(eventId);
          db.prepare('DELETE FROM face_embeddings WHERE event_id = ?').run(eventId);
          db.prepare('DELETE FROM media WHERE event_id = ?').run(eventId);
          db.prepare('DELETE FROM folders WHERE event_id = ?').run(eventId);
          db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
        });

        for (const ev of expiredBinEvents) {
          try {
            await storage.deleteEventStorage(ev.id);
            purgeTx(ev.id);
            console.log(`[Expiry Service] Purged expired Recycle Bin event "${ev.name}" (${ev.id}).`);
          } catch (purgeErr) {
            console.error(`[Expiry Service Error] Failed to purge event ${ev.id}:`, purgeErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[Expiry Service Error]:', err);
    }
  };

  // Run on startup
  checkExpiredEvents().catch(console.error);

  // Run periodically
  setInterval(() => {
    checkExpiredEvents().catch(console.error);
  }, intervalMs);
}

export default startExpiryWorker;
