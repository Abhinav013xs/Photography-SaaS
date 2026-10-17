# Security Incident Response Plan & Playbooks

**Application:** Studio Lumina — Production Photography SaaS  
**Version:** 1.0.0 (Phase 36 Hardened)  
**Classification:** Confidential — Operational Security Documentation  

---

## 1. Incident Response Lifecycle Overview

Studio Lumina adheres to the NIST SP 800-61 Rev. 2 Computer Security Incident Handling Guide. The incident response lifecycle consists of six distinct phases:

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  1. Preparation │ ──► │ 2. Detection &   │ ──► │  3. Containment  │
│  & Hardening    │     │    Analysis      │     │                  │
└─────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              │
│ 6. Post-Incident│ ◄── │   5. Recovery &  │ ◄────────────┘
│    Review       │     │      Validation  │   4. Eradication
└─────────────────┘     └──────────────────┘
```

### Incident Severity Tiers

| Severity | Definition | Target Containment SLA |
| :--- | :--- | :--- |
| **SEV-1 (Critical)** | Active exfiltration of private photos, database credential leak, R2 master key compromise, or cross-event biometric leakage. | **< 30 minutes** |
| **SEV-2 (High)** | Photographer account takeover, unauthorized gallery access, or persistent DoS against face-search pipeline. | **< 2 hours** |
| **SEV-3 (Medium)** | Brute-force PIN abuse, single guest token leak, or file upload validation rejection bypass attempts. | **< 6 hours** |
| **SEV-4 (Low)** | Non-exploitable scanner probes, transient rate-limit warnings, or failed credential stuffing. | **< 24 hours** |

---

## 2. Emergency Operational Playbooks

### Playbook 1: Photographer Account Compromise
*Trigger: Suspicious logins from unknown IP ranges, abnormal bulk deletion, or photographer report.*

1. **Immediate Session Revocation:**
   Rotate the application `AUTH_SECRET` environment variable immediately. This instantly invalidates all issued photographer JWT sessions:
   ```bash
   # Generate new 64-char cryptographically secure secret
   openssl rand -hex 32
   # Update AUTH_SECRET in production .env / VPS systemd environment
   # Restart API service
   systemctl restart photography-api
   ```
2. **Database Password Reset:**
   Issue a direct password update with a temporary secure random password:
   ```sql
   UPDATE users 
   SET password_hash = '$2b$12$...' -- newly generated bcrypt hash
   WHERE email = 'photographer@example.com';
   ```
3. **Audit Event Integrity:**
   Query `events` and `recycle_bin` tables for unauthorized deletions or modifications in the last 24 hours:
   ```sql
   SELECT id, name, status, updated_at 
   FROM events 
   WHERE updated_at >= NOW() - INTERVAL '24 hours' 
   ORDER BY updated_at DESC;
   ```
4. **Restore Compromised Data:**
   If any events were soft-deleted, restore them via the recycle bin service or database restore.

---

### Playbook 2: Cloudflare R2 Credentials Leak
*Trigger: R2 Access Key ID or Secret Access Key found in public commit, logs, or error reports.*

1. **Immediate Revocation in Cloudflare Dashboard:**
   - Log into Cloudflare Dashboard -> **R2 Object Storage** -> **Manage R2 API Tokens**.
   - Locate the compromised token and click **Delete** immediately.
2. **Issue New Scoped R2 Credentials:**
   - Create a new token scoped strictly to the specific production bucket with `Object Read & Write` permissions only (no bucket management permissions).
3. **Deploy Updated Credentials to Server:**
   - Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in the server `.env`.
   - Restart the Node.js API server (`systemctl restart photography-api`).
4. **Inspect R2 Access Logs:**
   - Review Cloudflare R2 bucket metrics and egress bandwidth spikes to identify unauthorized access.
   - Verify that all media keys conform to `events/{eventId}/{category}/{filename}`.

---

### Playbook 3: Database Credentials Leak
*Trigger: Neon PostgreSQL connection string (`DATABASE_URL`) detected in public repo or client bundle.*

1. **Neon Connection String Reset:**
   - In Neon Console -> Project Settings -> **Reset Role Password** for the application role.
2. **Update Server Connection String:**
   - Update `DATABASE_URL` in `.env` with the new password and TLS enforcement (`?sslmode=require`).
   - Restart API server.
3. **Audit Connection IP Logs:**
   - Review Neon connection history to ensure no connections originated from unauthorized external IPs.
   - Restrict Neon Allowed IP list to the VPS production IP address.

---

### Playbook 4: Guest Access Token / Event PIN Leak
*Trigger: Event PIN or guest token shared inappropriately or posted publicly.*

1. **Regenerate Event PIN:**
   - In the Photographer Dashboard, navigate to Event Settings -> Security -> Update PIN.
   - The backend hashes the new PIN via bcrypt (`$2b$12$`), invalidating the prior PIN.
2. **Revoke Active Guest Sessions:**
   - Update the event's `share_token` (cryptographically random hex):
   ```sql
   UPDATE events 
   SET share_token = encode(gen_random_bytes(32), 'hex') 
   WHERE id = :event_id;
   ```
   - Previous guest tokens signed or linked with old parameters will immediately be rejected.

---

### Playbook 5: Unauthorized Photo Access / Exfiltration
*Trigger: Log alerts showing 403 spikes or unexpected media download bursts.*

1. **Verify Download Route Logs:**
   Filter structured application logs for media access:
   ```bash
   journalctl -u photography-api -n 500 --no-pager | grep "download"
   ```
2. **Immediate Emergency Gallery Lockdown:**
   Set the targeted event's visibility to `private` or disable downloads immediately:
   ```sql
   UPDATE events 
   SET visibility = 'private', allow_downloads = false 
   WHERE id = :event_id;
   ```
   All downstream downloads (`/api/media/download/:mediaId` and `/api/media/download-zip/:eventId`) will immediately return `403 FORBIDDEN` via `checkDownloadAuthorization`.

---

### Playbook 6: Biometric / Face Embedding Exposure Incident
*Trigger: Accidental return of vector arrays or failure to delete temporary guest selfies.*

1. **Verify Ephemeral Deletion Routine:**
   Inspect `/tmp` or scratch directories on the server to verify zero lingering files:
   ```bash
   ls -la /tmp | grep -E "selfie|face"
   ```
2. **Verify Public API Vector Sanitization:**
   Confirm that public endpoints `/api/events/:slug/gallery` and `/api/events/:eventId/face-search` return only `media_id`, `score`, and display URLs, never raw embedding vectors.
3. **If Database Compromised:**
   Note that face embeddings stored in `photo_faces` are 128-dimensional mathematical feature vectors produced by OpenCV SFace. They **cannot** be reversed into original facial photographs. However, if an event's embeddings are suspected of tampering, re-index the event:
   ```sql
   DELETE FROM photo_faces WHERE event_id = :event_id;
   ```
   Then trigger the background photo indexing worker to re-extract embeddings from clean original photographs.

---

### Playbook 7: Malicious File Upload or Shell Attempt
*Trigger: `[VALIDATION_ERROR]` or `assertSafeUploadFilename` alert in application logs.*

1. **Locate Rejected Request Details:**
   Search structured logs for upload rejections:
   ```bash
   journalctl -u photography-api | grep "Unsafe filename detected"
   ```
2. **Verify Disk Cleanliness:**
   Verify no untracked files exist in the upload scratch directory:
   ```bash
   find ./temp -type f -name "*.php" -o -name "*.sh" -o -name "*.exe"
   ```
3. **IP Blacklist / Firewall Block:**
   Add offending attacker IP to VPS firewall (`ufw`):
   ```bash
   sudo ufw insert 1 deny from <ATTACKER_IP> to any
   ```

---

### Playbook 8: Face-Search DDoS / Rate-Limit Abuse
*Trigger: High CPU utilization on Python AI microservice (Port 8000) or 429 warnings.*

1. **Check Worker Metrics:**
   ```bash
   top -b -n 1 | grep python
   ```
2. **Enforce Stricter Rate Limiting:**
   Adjust `faceSearchLimiter` in `server/middleware/rate_limit.js` or configure Nginx upstream rate limiting:
   ```nginx
   limit_req_zone $binary_remote_addr zone=facesearch:10m rate=5r/m;
   ```
3. **Isolate AI Microservice:**
   Confirm FastAPI only listens on `127.0.0.1:8000` and is not exposed to the public internet.

---

## 3. Disaster Recovery, Backups & Restoration

### 3.1 Database Backups (Neon PostgreSQL)
- **Continuous Point-in-Time Recovery (PITR):** Neon automatically captures continuous WAL logs, allowing restoration to any second within the retention window (7 days on default tier).
- **Scheduled Logical Dump:** Run daily at 02:00 UTC via cron:
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --file="/backups/db/studio_lumina_$(date +%Y%m%d).dump"
  ```
- **Database Restoration Procedure:**
  ```bash
  pg_restore -d "$DATABASE_URL" --clean --no-owner "/backups/db/studio_lumina_YYYYMMDD.dump"
  ```

### 3.2 Cloudflare R2 Object Storage Resilience
- Cloudflare R2 inherently provides 99.999999999% (11 9's) annual durability across multi-datacenter replication.
- Accidental event deletion is protected by the two-stage **Recycle Bin**:
  - Deleted events remain in `recycle_bin` for 30 days.
  - Media objects remain intact in R2 until explicit permanent deletion is triggered.

---

## 4. Post-Incident Review Protocol

Within 48 hours of any SEV-1 or SEV-2 resolution:
1. Conduct root-cause analysis (RCA) meeting.
2. Identify detection lag, containment duration, and eradication gaps.
3. Add automated regression tests into `tests/integration/` replicating the attack pattern.
4. Update this incident response documentation with newly identified lessons.
