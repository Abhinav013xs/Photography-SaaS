# Operational Runbook: Production Deployment Rollback

**ID:** RB-DEP-005  
**Severity:** SEV-1 / SEV-2 (Failed Release or Breaking Regression)  
**Target Subsystem:** Full-Stack Application Deployment & Database Migrations  
**Audience:** DevOps Engineers, Release Managers, Full-Stack Architects  

---

## 1. Symptoms & Trigger Criteria
A rollback must be initiated immediately upon encountering any of the following post-deployment triggers:
- API error rate exceeds **1.0%** within 15 minutes of deployment.
- Database migration fails mid-execution with syntax or constraint errors.
- Critical authentication or authorization bypass detected.
- Guest face search or direct R2 photo downloads fail globally.
- Client SPA fails to render due to syntax error or chunk load failure.

---

## 2. Pre-Rollback Assessment & Safety Rules

> [!CRITICAL]
> **Database Migration Reversibility Warning:**  
> Never run destructive SQL `DROP` or `ALTER` down-migrations without verifying backup state. In this platform, all database migrations are engineered to be **additive and backward-compatible** (Expand/Contract pattern) to permit instant code rollbacks without requiring immediate database reversions.

1. **Identify the Last Known Healthy Release:**
   ```bash
   git log --oneline -n 5
   ```
2. **Check Current vs. Target Commit:**
   ```bash
   CURRENT_COMMIT=$(git rev-parse --short HEAD)
   PREVIOUS_COMMIT=$(git rev-parse --short HEAD~1)
   echo "Rolling back from ${CURRENT_COMMIT} to ${PREVIOUS_COMMIT}"
   ```

---

## 3. Step-by-Step Rollback Execution

### Step 1: Code Base Reversion
1. Check out the previous stable release commit or git tag:
   ```bash
   git checkout tags/v1.0.4-stable
   # Or by commit hash:
   # git checkout <stable_commit_hash>
   ```
2. Clean and reinstall verified production dependencies:
   ```bash
   npm ci --production
   ```

### Step 2: Client SPA Re-Build & Deployment
1. Rebuild the frontend bundle with Vite:
   ```bash
   npm --prefix client run build
   ```
2. Verify output in `client/dist/` (dist/index.html and hashed assets generated).

### Step 3: API Cluster Rolling Reload
1. Gracefully reload the backend server cluster with zero dropped HTTP connections:
   ```bash
   pm2 reload photography-api
   ```
2. Restart background queue worker instances:
   ```bash
   pm2 restart photo-worker video-worker ai-worker
   ```

### Step 4: Edge Cache Invalidation
1. In Cloudflare Dashboard, navigate to **Caching** $\rightarrow$ **Configuration** $\rightarrow$ **Purge Everything**.
2. Alternatively, trigger purge via Cloudflare API token:
   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
     -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
     -H "Content-Type: application/json" \
     --data '{"purge_everything":true}'
   ```

---

## 4. Database Migration Recovery

If the failed deployment included a database schema migration that must be reverted:

1. **Additive Migrations (Standard Practice):**
   - New columns with defaults or new indexes can remain in place safely while older code runs.
   - **No schema modification required.** Older code simply ignores extra columns.
2. **Destructive / Incompatible Migration Recovery:**
   - If schema changes broke backward compatibility, restore the database snapshot created immediately prior to deployment:
     ```bash
     npx tsx scripts/restore-db.ts --input backups/pre_deployment_snapshot.json
     ```

---

## 5. Verification & Post-Rollback Validation
1. Verify API liveness and readiness:
   ```bash
   curl -s http://localhost:5000/health/live | jq .status
   curl -s http://localhost:5000/health/ready | jq .status
   ```
   *Expected: `"ok"` and `"ready"`.*
2. Run critical automated regression checks:
   ```bash
   npx vitest run tests/integration/health.test.ts tests/integration/security.test.ts
   ```
3. Manually verify photographer dashboard login and guest gallery browsing in an incognito window.

---

## 6. Incident Retrospective & Escalation
- Tag the failed commit in Git: `git tag -a failed-deploy-YYYYMMDD -m "Failed release rollback"`
- Open a SEV-2 post-mortem task to investigate the root cause before attempting re-deployment.
- Escalate report to Lead SRE and Principal Architect.
