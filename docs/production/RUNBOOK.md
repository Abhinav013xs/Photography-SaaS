# Studio Lumina: Production Operations Runbook (Phase 49)

**Document Version:** 1.0.0 — Production Ready  
**Audience:** Platform Operators, Site Reliability Engineers, Lead Developers  
**Emergency Hotline / Primary Contact:** Studio Owner (Photographer)  

---

## 1. Quick Diagnostic Cheat-Sheet

| Diagnostic Goal | Command / Action |
| :--- | :--- |
| **Check API Liveness** | `curl -i http://localhost:3001/api/health` |
| **Check Readiness & Storage** | `curl -i http://localhost:3001/api/ready` |
| **Check Queue Telemetry** | `curl -i http://localhost:3001/api/queue/metrics` |
| **Run Automated Smoke Check**| `npx tsx scripts/production-smoke-check.ts` |
| **Audit DB & Storage Health** | `npx tsx scripts/verify-storage-consistency.ts` |
| **Generate Immediate Backup** | `npx tsx scripts/backup-db.ts` |
| **Check PM2 Process Status** | `pm2 status` |
| **View Live API Logs** | `pm2 logs api --lines 100` |

---

## 2. Standard Operating Procedures (SOP)

### SOP 1: Service Health Inspection & Triage
1. Execute the automated smoke check tool:
   ```bash
   npx tsx scripts/production-smoke-check.ts
   ```
2. If any check fails, review detailed error output:
   - **Liveness Fail:** Process is dead or event loop blocked. Jump to [SOP 2: Restarting Application Services](#sop-2-restarting-application-services).
   - **Readiness Fail:** Database disk I/O lock or missing storage credentials. Check `data/photographer.db` permissions and `.env.production`.
   - **Queue Fail:** Worker queue backlog stuck. Jump to [SOP 3: Clearing Queue Backlog](#sop-3-clearing-queue-backlog).

---

### SOP 2: Restarting Application Services
When restarting production services, avoid abrupt SIGKILL signals to protect in-flight SQLite WAL writes and file chunk uploads.

1. **Graceful Reload via PM2:**
   ```bash
   pm2 reload pm2/ecosystem.config.cjs
   ```
2. **Hard Restart (if process unresponsive):**
   ```bash
   pm2 restart pm2/ecosystem.config.cjs
   ```
3. **Verify Post-Restart State:**
   ```bash
   pm2 status
   curl -s http://localhost:3001/api/ready | jq .
   ```

---

### SOP 3: Clearing Queue Backlog & Hung Jobs
If `GET /api/queue/metrics` shows a persistent backlog of > 1,000 items that is not draining:

1. Check if the active concurrency is scaled up:
   ```bash
   curl -s http://localhost:3001/api/queue/metrics | jq .metrics
   ```
2. Verify Python worker process health:
   ```bash
   ps aux | grep -i python
   ```
3. If Python processes are wedged, restart the worker pool:
   ```bash
   pm2 restart ai
   ```
4. Failed jobs automatically retry up to 3 times before transitioning to `failed` in the `media` table, preventing infinite retry loops.

---

### SOP 4: Database Backup Procedure
Always trigger a manual backup before performing software updates, running schema migrations, or importing large photo batches.

1. Run the backup CLI tool:
   ```bash
   npx tsx scripts/backup-db.ts
   ```
2. Confirm the backup file exists and has non-zero size:
   ```bash
   ls -lh backups/ | tail -n 5
   ```
3. Backups are named `db_backup_YYYY-MM-DDTHH-mm-ss-sssZ.json` and contain an embedded SHA-256 integrity hash.

---

### SOP 5: Database Restore Procedure
Restoring from a snapshot completely rebuilds all tables inside an atomic transaction.

1. **Stop Application Traffic:**
   ```bash
   pm2 stop api
   ```
2. **Execute Restore:**
   ```bash
   npx tsx scripts/restore-db.ts --input backups/db_backup_TARGET_DATE.json
   ```
3. Confirm integrity report prints `Integrity Check: VERIFIED (0 orphan records)`.
4. **Restart API Server:**
   ```bash
   pm2 start api
   ```
5. **Run Smoke Check:**
   ```bash
   npx tsx scripts/production-smoke-check.ts
   ```

---

### SOP 6: Storage & Metadata Reconciliation
If a photographer reports that photos visible in the dashboard are failing to load thumbnails, run the storage reconciliation tool:

1. Execute the consistency audit:
   ```bash
   npx tsx scripts/verify-storage-consistency.ts
   ```
2. If missing storage objects are reported:
   - Check if Cloudflare R2 bucket name matches `.env.production`.
   - Verify network egress to Cloudflare storage endpoint.
   - For missing derivatives, trigger background thumbnail re-generation.

---

### SOP 7: Enabling & Disabling Platform Maintenance Mode
Studio Lumina supports an administrative maintenance mode that restricts non-admin guest traffic while allowing the photographer/admin full access to troubleshoot.

1. **Enable Maintenance Mode:**
   ```sql
   -- Connect to SQLite
   sqlite3 data/photographer.db "UPDATE feature_flags SET enabled = 1, updated_at = datetime('now') WHERE key = 'maintenance_mode';"
   ```
   *Non-admin requests receive HTTP 503 with user-friendly maintenance banner.*

2. **Disable Maintenance Mode:**
   ```sql
   sqlite3 data/photographer.db "UPDATE feature_flags SET enabled = 0, updated_at = datetime('now') WHERE key = 'maintenance_mode';"
   ```
   *Normal platform operations resume immediately.*
