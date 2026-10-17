# Disaster Recovery Operational Runbook

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  
**Target Audience:** SREs, DevOps Engineers, and Platform Administrators  

---

## 1. Emergency Quick Reference

| Emergency State | Immediate Action | Primary Command / URL |
| :--- | :--- | :--- |
| **API Crashing / Down** | Check service status & restart | `pm2 status` / `systemctl status photography-api` |
| **Database Corrupted** | Execute Neon PITR or restore snapshot | `npx tsx scripts/restore-db.ts --input <file>` |
| **Storage Inconsistency** | Audit missing / orphan objects | `npx tsx scripts/verify-storage-consistency.ts` |
| **Stuck Background Jobs** | Force worker crash recovery | Run `recoverStaleJobs()` or restart queue worker |
| **R2 Credentials Leaked** | Revoke in Cloudflare & rotate | Cloudflare Dashboard -> R2 -> API Tokens |

---

## 2. Standard 15-Step Disaster Recovery Protocol

```
┌────────────────────────────────────────────────────────┐
│              15-STEP DISASTER RECOVERY FLOW            │
├────────────────────────────────────────────────────────┤
│ 1. Incident ID      ──► 2. Scope       ──► 3. Contain  │
│ 4. Protect Creds    ──► 5. DB State    ──► 6. R2 State │
│ 7. Restore DB       ──► 8. Reconnect   ──► 9. Backend  │
│ 10. Workers         ──► 11. Integrity  ──► 12. Test    │
│ 13. Enable Traffic  ──► 14. Monitor    ──► 15. Review  │
└────────────────────────────────────────────────────────┘
```

### Step 1: Incident Identification
- Receive alert from synthetic health probe (`/health`), user report, or SRE monitoring.
- Classify severity tier (SEV-1 through SEV-4).
- Open an emergency incident bridge (Slack channel `#incident-emergency` or dedicated call).

### Step 2: Determine Scope
- Verify which components are degraded or offline:
  - Is the database responding? (`curl -I http://localhost:3001/health`)
  - Is Cloudflare R2 reachable? (`aws s3 ls s3://studio-lumina-bucket --endpoint-url ...`)
  - Is the Python AI face service responding? (`curl http://localhost:8000/health`)
  - Is the frontend serving assets?

### Step 3: Stop Further Damage (Containment)
- If active corruption, intrusion, or credential leak is suspected:
  - Put the public edge (Nginx or Cloudflare) into **Maintenance Mode** (return HTTP 503 with friendly status page).
  - Stop background processing queues (`pm2 stop photo-worker`).

### Step 4: Protect Credentials & Secrets
- If a security breach or token leak triggered the outage:
  - Rotate Neon database credentials (`DATABASE_URL`).
  - Rotate Cloudflare R2 Access Keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
  - Rotate JWT session secret (`AUTH_SECRET`).

### Step 5: Determine Database State
- Probe the database:
  - If Neon database is offline or schema is corrupted, check the last known healthy transaction timestamp in Neon Console.
  - Check available local or remote snapshots in `/backups/`.

### Step 6: Determine Cloudflare R2 State
- Verify R2 bucket accessibility and object hierarchy integrity:
  - Run `aws s3 ls s3://<bucket>/events/` or run `scripts/verify-storage-consistency.ts`.
  - Confirm original photographs (`events/{id}/originals/`) are intact.

### Step 7: Restore Database
- **Option A (Neon PITR - Recommended):**
  1. In Neon Console, create a new branch from timestamp `T - (Incident Duration + 5m)`.
  2. Point `DATABASE_URL` in `.env` to the recovered branch.
- **Option B (Independent Cold Snapshot):**
  1. Locate the latest verified JSON snapshot in `/backups/`.
  2. Run the restore utility:
     ```bash
     npx tsx scripts/restore-db.ts --input backups/db_backup_LATEST.json
     ```
  3. Verify the SHA-256 integrity check and confirmation output.

### Step 8: Reconnect & Verify Storage
- Ensure API and worker services can authenticate to Cloudflare R2:
  ```bash
  node -e "import('./server/storage/r2.js').then(m => m.default.hasObject('test').then(console.log))"
  ```

### Step 9: Restore Backend Application
- If host was rebuilt or crashed:
  1. Pull repository: `git pull origin main`
  2. Install production dependencies: `npm ci --omit=dev`
  3. Build client production bundle: `npm --prefix client run build`
  4. Start API server: `pm2 start server/index.js --name photography-api`

### Step 10: Restore AI Workers & Processing Queues
- Launch Python AI microservice:
  ```bash
  uvicorn apps.ai.main:app --host 127.0.0.1 --port 8000 --workers 2
  ```
- Trigger worker crash recovery:
  - The queue automatically runs `recoverStaleJobs()` on startup.
  - Verify that stuck media and jobs have transitioned out of `processing`.

### Step 11: Run Relational & Storage Integrity Checks
- Execute the storage consistency checker:
  ```bash
  npx tsx scripts/verify-storage-consistency.ts
  ```
- Confirm zero orphan records, zero missing storage objects, and zero broken foreign keys.

### Step 12: Test Critical Functional Workflows (Smoke Testing)
- Verify end-to-end functionality via automated CLI or browser checks:
  1. Photographer login -> 200 OK.
  2. Event gallery list -> 200 OK.
  3. Image display and preview streaming -> 200 OK.
  4. Test face search against an indexed event -> 200 OK with correct match confidence.
  5. Test photo download -> 200 OK.

### Step 13: Re-Enable Production Traffic
- Remove Nginx / Cloudflare maintenance mode rule.
- Allow public DNS traffic back to the primary endpoint.

### Step 14: Monitor & Post-Recovery Health Check
- Monitor error rates, response latencies, and CPU/memory usage for the next 2 hours.
- Verify structured logs show healthy HTTP 200 responses.

### Step 15: Post-Incident Review & Documentation
- Within 48 hours:
  - Document the incident timeline, root cause, RPO achieved, and RTO achieved in `docs/reliability/incident-reports/`.
  - Add regression test cases if the failure was caused by application logic.
