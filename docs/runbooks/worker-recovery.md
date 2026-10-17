# Operational Runbook: AI Worker & Background Queue Recovery

**ID:** RB-WK-003  
**Severity:** SEV-2 (Feature Processing Backlog)  
**Target Subsystem:** Python Face AI Workers / Redis BullMQ Priority Queues  
**Audience:** SREs, AI/ML Engineers, Backend Reliability Engineers  

---

## 1. Symptoms & Detection
- Newly uploaded event photos remain in `processing` status indefinitely (> 10 minutes).
- Queue backlog metric (`waiting` jobs) continues climbing without draining.
- Real-time queue metrics endpoint (`/api/storage/metrics` or internal probe) reports:
  ```json
  { "queue": "photo-processing", "waiting": 150, "active": 0 }
  ```
- Worker process memory reaches 90%+ RAM; supervisor logs indicate SIGSEGV or OOM kills.
- Guests performing face searches experience delayed responses or timeouts.

---

## 2. Diagnosis Protocols

1. **Check Queue Depth & Worker Status:**
   ```bash
   npx tsx -e "
     import { getBackgroundInfrastructureHealth } from './apps/api/src/services/queue/jobRecoveryService.js';
     getBackgroundInfrastructureHealth().then(h => console.log(JSON.stringify(h, null, 2)));
   "
   ```
2. **Inspect Running Worker Processes:**
   ```bash
   pm2 status
   # Or for native systemd / docker:
   ps aux | grep -E "python.*(main|biometrics)|node.*worker"
   ```
3. **Inspect Python Face Engine Model Health:**
   ```bash
   python apps/ai/benchmark.py
   ```
   *Verifies that YuNet and SFace ONNX weight files are loaded and functional.*
4. **Inspect Stuck Leased Jobs in Database:**
   ```sql
   SELECT id, media_id, status, attempts, lease_expires_at, error_code 
   FROM processing_jobs 
   WHERE status = 'processing' AND lease_expires_at < NOW();
   ```

---

## 3. Step-by-Step Remediation

### Path A: Dead Worker Process Restart
If worker processes crashed or were terminated by Linux OOM killer:
1. Restart worker cluster:
   ```bash
   pm2 restart photo-worker video-worker ai-worker
   ```
2. Confirm worker logs report successful model initialization:
   ```bash
   pm2 logs ai-worker --lines 20
   ```
   *Expected output: `[YuNet] Face detector loaded (640x640)` and `[SFace] Feature extractor loaded (128-D)`.*

### Path B: Stuck Job Reclaim & Queue Drainage
Jobs abandoned by dead workers must be reclaimed:
1. Manually trigger the stuck-job reclamation cycle:
   ```bash
   npx tsx -e "
     import { reclaimStuckJobs } from './apps/api/src/services/queue/jobRecoveryService.js';
     reclaimStuckJobs().then(res => console.log('Reclaim result:', res));
   "
   ```
   *Reclaims expired leases (`reclaimed > 0`), dead-letters jobs exceeding max attempts, and unlocks media.*
2. For specific stuck media items, force an atomic retry:
   ```bash
   npx tsx -e "
     import { retryFailedJob } from './apps/api/src/services/queue/jobRecoveryService.js';
     retryFailedJob('<media_id>').then(console.log);
   "
   ```

### Path C: Backlog Surge Scaling
If a large event upload (e.g. 10,000 photos) creates an acute queue backlog:
1. Temporarily scale out worker concurrency:
   ```bash
   pm2 scale photo-worker +3
   ```
2. Monitor CPU utilization (`htop` or `top`). Ensure total system CPU stays under 85%.
3. Once queue depth reaches `< 10`, scale workers back to standard baseline:
   ```bash
   pm2 scale photo-worker 2
   ```

---

## 4. Verification & Validation
1. Verify queue metrics return to normal operational limits:
   - `waiting: 0`
   - `active: 0–4`
   - `failed: 0`
2. Verify recent media records transition to `ready`:
   ```sql
   SELECT count(*) FROM media WHERE status = 'ready' AND created_at > NOW() - INTERVAL '15 minutes';
   ```
3. Verify face embeddings table contains matching rows:
   ```sql
   SELECT count(*) FROM face_embeddings WHERE created_at > NOW() - INTERVAL '15 minutes';
   ```

---

## 5. Rollback Procedures
- If scaled workers cause server memory exhaustion, immediately throttle concurrency back to 1 worker process:
  ```bash
  pm2 scale photo-worker 1
  ```

---

## 6. Escalation Matrix
- **Level 1 (0–15 mins):** Restart workers and execute `reclaimStuckJobs()`.
- **Level 2 (15–30 mins):** Scale worker processes; inspect Python ONNX runtime errors.
- **Level 3 (30+ mins):** Escalate to SRE Lead and AI Pipeline Specialist.
