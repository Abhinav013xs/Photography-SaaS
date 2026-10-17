# Operational Runbook: API Server Outage & Cluster Recovery

**ID:** RB-API-004  
**Severity:** SEV-1 (Critical Availability Outage)  
**Target Subsystem:** Express API Cluster / HTTP Routing Nodes  
**Audience:** Site Reliability Engineers, DevOps Engineers, Full-Stack Engineers  

---

## 1. Symptoms & Detection
- Ingress reverse proxy returns `HTTP 502 Bad Gateway` or `HTTP 504 Gateway Timeout`.
- Synthetic uptime monitor reports outage on `GET /health/live`.
- Node.js processes in PM2 / Docker enter `errored` or `restart loop` states.
- Error logs report `FATAL: Uncaught Exception` or `JavaScript heap out of memory`.
- Elevated latency on photographer dashboard routes (> 5,000ms).

---

## 2. Diagnosis Protocols

1. **Check Process Manager Status:**
   ```bash
   pm2 status
   ```
   *Look for elevated restart counts (`↺`) or status other than `online`.*
2. **Probe Liveness & Readiness Probes Locally:**
   ```bash
   curl -i http://localhost:5000/health/live
   curl -i http://localhost:5000/health/ready
   ```
3. **Inspect Latest Crash Logs:**
   ```bash
   pm2 logs photography-api --err --lines 50
   ```
4. **Inspect Memory & Event Loop Saturation:**
   ```bash
   pm2 monit
   ```
   *Check if process heap exceeds 1.5 GB or event loop latency spikes.*

---

## 3. Step-by-Step Remediation

### Path A: Clean Process Reload (Zero-Downtime)
If API is degraded due to memory fragmentation or transient deadlock:
1. Trigger a zero-downtime rolling reload:
   ```bash
   pm2 reload photography-api
   ```
   *PM2 gracefully shuts down one worker at a time while surviving instances serve traffic.*
2. Verify all cluster instances return to `online` status.

### Path B: Crash Loop Recovery (Code / Config Error)
If the server crashes immediately upon startup:
1. Inspect the last startup error log:
   ```bash
   pm2 logs photography-api --lines 30
   ```
2. Check for missing or corrupted environment variables:
   ```bash
   npx tsx scripts/validate-env.ts
   ```
3. If a bad configuration was deployed, revert `.env.production` from the backup vault:
   ```bash
   cp .env.production.bak .env.production
   pm2 restart photography-api --update-env
   ```

### Path C: Port Conflict or Zombie Process
If Express fails with `EADDRINUSE: address already in use :::5000`:
1. Identify the rogue process holding port 5000:
   ```bash
   lsof -i :5000
   # Or on Windows:
   netstat -ano | findstr :5000
   ```
2. Terminate the zombie PID:
   ```bash
   kill -9 <PID>
   ```
3. Restart the managed cluster:
   ```bash
   pm2 restart photography-api
   ```

---

## 4. Verification & Validation
1. Verify liveness probe returns HTTP 200:
   ```bash
   curl -s http://localhost:5000/health/live | jq .
   ```
   *Expected: `{ "status": "ok", "service": "photography-api" }`.*
2. Verify readiness probe returns HTTP 200:
   ```bash
   curl -s http://localhost:5000/health/ready | jq .
   ```
   *Expected: `{ "status": "ready", "database": { "status": "healthy" } }`.*
3. Execute end-to-end ping through public Cloudflare edge:
   ```bash
   curl -s -I "https://api.studiolumina.photo/health/live"
   ```
   *Expected: HTTP 200 with `X-Request-Id` and `Strict-Transport-Security` headers.*

---

## 5. Rollback Procedures
- If the current release build contains a fatal regression, trigger immediate deployment rollback:
  ```bash
  # See RB-DEP-005 for detailed deployment rollback steps
  git checkout HEAD~1
  npm ci
  pm2 reload photography-api
  ```

---

## 6. Escalation Matrix
- **Level 1 (0–10 mins):** On-Call Engineer executes `pm2 reload` and inspects crash logs.
- **Level 2 (10–20 mins):** SRE Lead rolls back deployment if crash loop persists.
- **Level 3 (20+ mins):** Escalate to Principal Backend Architect.
