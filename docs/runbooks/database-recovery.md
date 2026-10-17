# Operational Runbook: Database Failure & Recovery

**ID:** RB-DB-001  
**Severity:** SEV-1 (Critical Outage)  
**Target Subsystem:** Neon Serverless PostgreSQL / pgvector  
**Audience:** Site Reliability Engineers, DevOps Engineers, On-Call System Administrators  

---

## 1. Symptoms & Detection
- API health check `/health/ready` returns `HTTP 503 Service Unavailable` with payload:
  ```json
  { "status": "not_ready", "database": { "status": "unhealthy" } }
  ```
- Application logs contain recurring errors:
  - `ECONNREFUSED` or `ETIMEDOUT` when connecting to PostgreSQL host.
  - `remaining connection slots are reserved for non-replication superuser connections`.
  - `terminating connection due to administrator command`.
- Photographer dashboard displays "Database connection offline" toast notifications.
- Guests attempting gallery or face searches receive `HTTP 500` or `HTTP 503`.

---

## 2. Diagnosis Protocols

Execute the following diagnostic steps from a bastion host or terminal:

1. **Verify Network & Host Reachability:**
   ```bash
   npx tsx -e "
     import { query } from './apps/api/src/infrastructure/database.js';
     query('SELECT 1').then(() => console.log('DB OK')).catch(console.error);
   "
   ```
2. **Inspect Connection Pool Saturation:**
   ```sql
   SELECT count(*), state FROM pg_stat_activity GROUP BY state;
   ```
   *If active connections equal `max_connections`, PgBouncer or the connection pool is saturated.*
3. **Inspect Neon Console Health:**
   - Log into [console.neon.tech](https://console.neon.tech).
   - Check compute status (Idle, Active, Failed, Suspended).
   - Check storage quota and point-in-time recovery timeline.

---

## 3. Step-by-Step Remediation

### Path A: Connection Pool Saturation (Soft Degradation)
1. Terminate idle or orphaned backend connections:
   ```sql
   SELECT pg_terminate_backend(pid) 
   FROM pg_stat_activity 
   WHERE state = 'idle in transaction' AND state_change < NOW() - INTERVAL '5 minutes';
   ```
2. Restart the API cluster gracefully to flush connection pools:
   ```bash
   pm2 reload photography-api
   ```

### Path B: Neon Branch Failover / Compute Crash
1. In the Neon Console, verify if the compute instance is in a crash loop.
2. If compute is unresponsive, trigger an immediate compute restart via the Neon dashboard or CLI:
   ```bash
   neonctl computes start --project-id <project_id>
   ```
3. If primary branch data is corrupted, create a new branch from PITR (Point-in-Time Recovery) timestamp prior to corruption.
4. Update `.env.production` with the new endpoint URL:
   ```bash
   DATABASE_URL="postgres://user:pass@ep-restored.us-east-1.neon.tech/lumina?sslmode=require"
   ```
5. Reload API instances:
   ```bash
   pm2 restart photography-api --update-env
   ```

### Path C: Cold Disaster Restoration from Snapshot
If Neon cloud services are experiencing a total outage:
1. Spin up an emergency local/RDS/VPS PostgreSQL 16 container with `pgvector`:
   ```bash
   docker run -d --name emergency-postgres -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=lumina -p 5432:5432 pgvector/pgvector:pg16
   ```
2. Restore database from verified offline snapshot:
   ```bash
   npx tsx scripts/restore-db.ts --input backups/db_backup_latest.json
   ```
3. Verify restored tables and record counts:
   ```bash
   npx tsx scripts/check-health.ts
   ```

---

## 4. Verification & Validation
1. Probe API readiness:
   ```bash
   curl -s http://localhost:5000/health/ready | jq .
   ```
   *Expected response: `status: "ready"` with database latency < 30ms.*
2. Verify relational integrity:
   - Check events listing: `curl -H "Authorization: Bearer <token>" http://localhost:5000/api/events`
   - Test a guest face search query against indexed embeddings.

---

## 5. Rollback Procedures
- If the newly restored branch has missing data compared to WAL logs, pause traffic and revert to read-only mode while WAL replay is completed.
- To prevent inconsistent writes during recovery:
  ```bash
  export READ_ONLY_MODE=true
  ```

---

## 6. Escalation Matrix
- **Level 1 (0–15 mins):** On-Call Engineer executes Path A / Path B.
- **Level 2 (15–30 mins):** SRE Lead provisions PITR branch; notifies Lead Photographer.
- **Level 3 (30+ mins):** Full Disaster Recovery protocol initiated (Path C); Neon support ticket raised with Priority High.
