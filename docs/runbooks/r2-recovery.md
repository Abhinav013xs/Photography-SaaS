# Operational Runbook: Cloudflare R2 Media Storage Recovery

**ID:** RB-R2-002  
**Severity:** SEV-2 (Major Feature Degraded)  
**Target Subsystem:** Cloudflare R2 Object Storage / S3 Adapter  
**Audience:** SREs, DevOps Engineers, Backend Infrastructure Engineers  

---

## 1. Symptoms & Detection
- Media uploads fail with `HTTP 500` or `HTTP 502` (`Failed to generate upload URL`).
- Guests clicking "Download Photo" receive `SignatureDoesNotMatch` or `InvalidAccessKeyId` XML errors from Cloudflare.
- Gallery view renders blank image tiles with broken thumbnail icons.
- Application logs contain:
  - `S3Exception: Access Denied`.
  - `RequestTimeTooSkewed`.
  - `NoSuchBucket: The specified bucket does not exist`.

---

## 2. Diagnosis Protocols

1. **Verify Storage Adapter Credentials:**
   Run the CLI storage probe:
   ```bash
   npx tsx -e "
     import { storageAdapter } from './apps/api/src/infrastructure/storageAdapter.js';
     storageAdapter.listObjects({ prefix: 'events/', maxKeys: 5 })
       .then(res => console.log('R2 Reachable:', res.keys.length, 'objects found'))
       .catch(err => console.error('R2 Error:', err.message));
   "
   ```
2. **Check System Clock Skew:**
   *AWS S3 presigned signatures fail if server clock differs by more than 15 minutes.*
   ```bash
   timedatectl status
   ```
   *Ensure NTP synchronization is active (`NTP service: active`).*
3. **Execute Storage Consistency Audit:**
   ```bash
   npx tsx scripts/verify-storage-consistency.ts
   ```
   *Examines whether database records match physical R2 keys.*

---

## 3. Step-by-Step Remediation

### Path A: Credential Invalidation / Token Expiry
1. Log into the Cloudflare Dashboard:
   - Navigate to **R2** $\rightarrow$ **Manage API Tokens**.
   - Create a new API token with `Object Read & Write` permissions scoped to bucket `studio-lumina-media`.
2. Update environment variables in `.env.production`:
   ```bash
   CLOUDFLARE_R2_ACCESS_KEY_ID="<new_access_key>"
   CLOUDFLARE_R2_SECRET_ACCESS_KEY="<new_secret_key>"
   ```
3. Restart API workers:
   ```bash
   pm2 restart photography-api --update-env
   ```

### Path B: Missing Thumbnails / Previews (Derivatives Lost)
If original master photos exist in R2 but derivatives were deleted or corrupted:
1. Originals are stored deterministically under:
   `events/{event_id}/originals/{photo_id}.jpg`
2. Trigger the automated derivative regeneration pipeline:
   ```bash
   npx tsx scripts/regenerate-derivatives.ts --scope all
   ```
3. The background worker pool will read master files, regenerate 400px WebP thumbnails and 1600px WebP previews, and re-upload them to R2.

### Path C: Orphaned Storage Objects Cleanup
If storage costs are climbing due to abandoned uploads:
1. Run audit report in dry-run mode:
   ```bash
   npx tsx scripts/verify-storage-consistency.ts
   ```
2. Purge verified unreferenced orphaned objects:
   ```bash
   npx tsx scripts/purge-orphan-media.ts --dry-run=false
   ```

---

## 4. Verification & Validation
1. Verify presigned download generation:
   ```bash
   curl -I -s "http://localhost:5000/api/media/download/<media_id>"
   ```
   *Expected response: HTTP 200 with JSON payload containing authenticated Cloudflare R2 download URL.*
2. Follow URL in browser or curl to verify image bytes transfer without error.

---

## 5. Rollback Procedures
- If newly generated credentials fail, restore previous credentials from the backup `.env.backup` file:
  ```bash
  cp .env.production.backup .env.production && pm2 reload photography-api
  ```

---

## 6. Escalation Matrix
- **Level 1 (0–15 mins):** Verify NTP clock and validate R2 credentials.
- **Level 2 (15–30 mins):** Reissue Cloudflare API token; notify Studio Owner.
- **Level 3 (30+ mins):** Escalate to Cloudflare Support with account ID and bucket name.
