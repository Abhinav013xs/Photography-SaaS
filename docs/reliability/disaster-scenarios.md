# Disaster Recovery Scenarios & Test Matrix

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  
**Standard:** NIST SP 800-34 Rev. 1 Contingency Planning Guide  

---

## 1. Scenario Evaluation Matrix

| ID | Disaster Scenario | Primary Impact | Detection Mechanism | Immediate Action | Recovery Method | Target RTO | Target RPO | Responsible Owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SC-01** | **Accidental Event Deletion** | Event disappears from active gallery view; guests see 404/410. | Photographer alert or dashboard audit log. | Prevent permanent purge; verify item in Recycle Bin. | Click **Restore** in Dashboard BinView or execute `UPDATE events SET deleted_at=NULL, purge_after=NULL WHERE id=:id`. | **< 2 mins** | **0 mins** | Photographer / Owner |
| **SC-02** | **Accidental Permanent Event Deletion** | Event record purged from DB and media purged from R2. | Photographer ticket or empty gallery report. | Quarantine backup snapshot; verify deletion timestamp. | Locate most recent pre-deletion snapshot; restore event, media, and embeddings records; re-upload source files if archived. | **< 1 hour** | **< 24 hours** | Lead DevOps |
| **SC-03** | **Database Corruption / WAL Failure** | SQL syntax/read errors; 500 errors on all API endpoints. | Health check probes (`/health`) return 500; Neon alerts. | Terminate write traffic (set API to maintenance mode). | Execute Neon Point-in-Time Recovery (PITR) to timestamp prior to corruption, or restore latest verified logical snapshot via `scripts/restore-db.ts`. | **< 20 mins** | **< 1 min** | Lead DevOps |
| **SC-04** | **Errant / Destructive Migration** | Missing columns, broken foreign keys, failed DDL. | `scripts/migrate.ts status` shows failed status; API crash. | Stop API instances from issuing further conflicting queries. | Execute migration rollback: `npx tsx scripts/migrate.ts down` or branch from Neon pre-migration state. | **< 10 mins** | **0 mins** | Backend Engineer |
| **SC-05** | **Backend Host / VPS Failure** | API server unreachable; HTTP 502/504 Bad Gateway at Nginx. | Uptime Kuma / Datadog external synthetic probe alert. | Verify DB and Cloudflare R2 are healthy (they run independently). | Provision replacement VPS or restart container; pull repository, inject `.env`, launch with `npm run start:prod` / PM2. | **< 15 mins** | **0 mins** | SRE / DevOps |
| **SC-06** | **Face-Processing Worker Failure / OOM Crash** | Media uploads stuck in `processing`; face search unavailable. | Queue backlog metrics; `stuckJobs` detected in periodic audit. | Inspect system memory; restart Python AI worker process. | Automated `recoverStaleJobs` reaps expired leases, resets media to `uploaded`, and retries jobs with exponential backoff. | **< 5 mins** | **0 mins** | AI / Backend Lead |
| **SC-07** | **Cloudflare R2 Credential Compromise** | Unauthorized token usage; potential data tampering. | Cloudflare Audit Logs; unauthorized API token use warning. | Revoke compromised R2 token in Cloudflare Dashboard immediately. | Generate new R2 API token with restricted bucket scope; update `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in `.env`; restart API. Media data remains 100% intact. | **< 15 mins** | **0 mins** | Security / DevOps |
| **SC-08** | **Accidental Bulk Media Deletion** | Photographs missing in gallery grid; broken image links. | `verify-storage-consistency.ts` flags missing storage objects. | Halt deletion workers; inspect R2 object bucket event history. | If deleted within application, objects in Recycle Bin remain intact. If R2 bucket objects deleted, restore from cold secondary archive or re-upload from photographer master catalog. | **< 2 hours** | **< 24 hours** | DevOps / Photographer |
| **SC-09** | **Database Credential Leak** | Potential unauthorized query execution or exfiltration. | Secrets scanner alert (GitGuardian) or public leak notification. | Reset Neon role password in Neon Console; terminate active pool connections. | Update `DATABASE_URL` with new credentials; restart API server. Audit query history in Neon metrics for unauthorized read patterns. | **< 15 mins** | **0 mins** | Security Lead |
| **SC-10** | **Total Infrastructure Loss (Data Center Disaster)** | VPS destroyed, local disks wiped, all hosts offline. | Complete infrastructure unavailability across all endpoints. | Convene emergency recovery protocol; acquire fresh cloud host (e.g. AWS, Hetzner, DigitalOcean). | Deploy source code from git -> Configure DNS -> Connect to Neon PostgreSQL & Cloudflare R2 -> Run consistency check -> Re-open traffic. | **< 45 mins** | **< 1 min** | Lead Architect |

---

## 2. In-Depth Operational Analysis of Key Scenarios

### Scenario 1: Accidental Event Deletion (Recycle Bin Workflow)
Studio Lumina enforces a two-tier deletion lifecycle. When an event is deleted from the dashboard:
1. `deleted_at` timestamp is set to `CURRENT_TIMESTAMP`.
2. `purge_after` timestamp is set to `CURRENT_TIMESTAMP + 30 days`.
3. The event status is updated to `archived` / `recycled`.
4. The media objects in Cloudflare R2 **remain 100% untouched**.
5. Restoration requires simply clicking **Restore** in the UI or running the database restoration query. Zero backup archives need to be mounted.

### Scenario 6: Worker Process Crash & Lease Recovery
If a node runs out of memory during a heavy 100-photo batch indexing job:
1. The process terminates abruptly without updating `media` status.
2. The newly implemented `recoverStaleJobs()` service runs automatically every 60 seconds (and upon server restart).
3. Any photo in `processing` whose original file is preserved on disk or storage is reset to `uploaded`.
4. The main worker loop picks up the uncompleted items and resumes processing seamlessly.

### Scenario 10: Complete Infrastructure Loss
Because the platform architecture adheres to strict separation of concerns:
- **Code:** Version-controlled in GitHub.
- **Compute:** Stateless Node.js / FastAPI services running on Linux.
- **Relational & Vector Data:** Neon Serverless PostgreSQL with automated multi-AZ replication.
- **High-Resolution Media:** Cloudflare R2 distributed object storage.
A complete destruction of the compute host can be restored in under 45 minutes on any modern Linux server with Docker / Node.js installed.
