# PHASE 47 — PRODUCTION HARDENING & QA ISSUE REPORT

============================================================
SYSTEM HEALTH & DEFECT REGISTER
============================================================

This document tracks all vulnerabilities, integrity bugs, and reliability weaknesses identified, reproduced, remediated, and verified during **Phase 47: Production Hardening, Security Audit, Performance Testing, Failure Recovery & Full System QA**.

---

## 1. SUMMARY METRICS

| Severity | Total Identified | Remediated | Verified | Status |
| :--- | :---: | :---: | :---: | :---: |
| **CRITICAL** | 0 | 0 | 0 | **CLEAN** |
| **HIGH** | 3 | 3 | 3 | **RESOLVED** |
| **MEDIUM** | 3 | 3 | 3 | **RESOLVED** |
| **LOW** | 1 | 1 | 1 | **RESOLVED** |
| **TOTAL** | **7** | **7** | **7** | **100% RESOLVED** |

---

## 2. DETAILED DEFECT REGISTER

### ISSUE-47-01: Photographer Session Revocation Bypass After Admin Suspension
- **Severity:** HIGH
- **Affected Component:** `server/middleware/auth.js` (`authenticatePhotographer`)
- **Reproduction Steps:**
  1. An admin suspends a photographer account via `UPDATE photographers SET status = 'suspended' WHERE id = :id`.
  2. The photographer issues an authenticated request (`GET /api/events` or `POST /api/events`) with their existing, non-expired 7-day JWT.
  3. Observe that the request succeeds (HTTP 200).
- **Root Cause:**
  `authenticatePhotographer` only verified the cryptographic JWT signature and assigned `req.user = decoded`. It never checked the SQLite database to confirm whether the photographer account still existed or had been suspended.
- **Fix:**
  Added real-time database validation in `authenticatePhotographer`:
  ```javascript
  const photographer = db.prepare('SELECT id, email, status FROM photographers WHERE id = ?').get(decoded.id);
  if (!photographer) {
    return res.status(401).json({ error: 'Account no longer exists' });
  }
  if (photographer.status !== 'active') {
    return res.status(403).json({ error: 'Account suspended. Please contact platform support.', code: 'ACCOUNT_SUSPENDED' });
  }
  ```
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("revokes access immediately when photographer account is suspended by admin"). Passed with HTTP 403.

---

### ISSUE-47-02: Missing Multi-Key Deletion & Orphaned Storage in Cloudflare R2
- **Severity:** HIGH
- **Affected Component:** `server/storage/r2.js` (`deleteEventStorage`, `deleteObjects`)
- **Reproduction Steps:**
  1. Upload 50 photos to an event (originals, previews, thumbnails created in R2).
  2. Move event to Recycle Bin and trigger permanent deletion (`DELETE /api/events/:id/permanent`).
  3. Inspect Cloudflare R2 bucket.
  4. Observe that original and derivative objects remained in R2 storage, incurring unnecessary storage costs.
- **Root Cause:**
  `deleteEventStorage` only logged the target prefix (`console.log`) without instantiating `ListObjectsV2Command` or batch `DeleteObjectsCommand`.
- **Fix:**
  Implemented complete bulk object deletion supporting `DeleteObjectsCommand` in batches of 1,000 keys (AWS S3 limit), with deterministic prefix listing:
  ```javascript
  async function deleteObjects(keys) {
    // Chunks keys into batches of 1,000
    for (const chunk of chunks) {
      await r2Client.send(new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: chunk.map((Key) => ({ Key })) }
      }));
    }
  }
  ```
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("purges all event media keys from Cloudflare R2 on event permanent deletion"). Passed with zero orphaned keys.

---

### ISSUE-47-03: Disk Space Leak in Asynchronous Upload Worker
- **Severity:** MEDIUM
- **Affected Component:** `server/services/queue.js` (Processing Worker)
- **Reproduction Steps:**
  1. Upload a malformed or corrupted image file, or trigger a Sharp / OpenCV processing exception.
  2. The processing job fails with status `failed`.
  3. Inspect `uploads/` scratch directory.
  4. Observe that the original temporary upload file remained on disk permanently.
- **Root Cause:**
  `fs.unlinkSync(item.storage_key_original)` was called only at the end of the `try` block. Any exception thrown during derivative generation or facial embedding bypassed the cleanup statement.
- **Fix:**
  Encapsulated worker processing in a strict `try...finally` block guaranteeing file unlinking:
  ```javascript
  try {
    // Process image derivatives and face embeddings...
  } finally {
    if (item.storage_key_original && fs.existsSync(item.storage_key_original)) {
      try { fs.unlinkSync(item.storage_key_original); } catch (e) { /* ignore */ }
    }
  }
  ```
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("worker releases temporary upload files on disk even when processing fails"). Verified that `fs.existsSync(tempFile)` is `false`.

---

### ISSUE-47-04: Non-Atomic Permanent Event Deletion & Foreign Key Cascading
- **Severity:** HIGH
- **Affected Component:** `server/routes/events.js` (`purgeEventDatabaseRecords`)
- **Reproduction Steps:**
  1. An event with client proofing collections (`selection_collections`), revisions (`selection_revisions`), and selected items (`selection_items`) is deleted.
  2. Sequential non-transactional `DELETE` queries run against the database.
  3. If an intermediate failure occurs, partial records remain, causing orphaned selections and foreign key violations.
- **Root Cause:**
  No database transaction wrapped the deletion sequence, and new proofing tables added in Phase 46 were not included in the purge cascade.
- **Fix:**
  Implemented `purgeEventDatabaseRecords(eventId)` wrapped in a single SQLite atomic transaction:
  ```javascript
  function purgeEventDatabaseRecords(eventId) {
    const purgeTx = db.transaction(() => {
      // 1. Delete selection revisions & items
      // 2. Delete selection collections
      // 3. Delete processing jobs
      // 4. Delete face embeddings
      // 5. Delete media & folders
      // 6. Delete event record
    });
    purgeTx();
  }
  ```
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("atomic permanent deletion cascades cleanly across events, media, and selections"). Verified all related tables are cleanly zeroed out in SQLite.

---

### ISSUE-47-05: Expired Recycle Bin Garbage Accumulation
- **Severity:** MEDIUM
- **Affected Component:** `server/services/expiry_checker.js`
- **Reproduction Steps:**
  1. An event is deleted and placed in Recycle Bin with a 30-day retention (`purge_after = date`).
  2. The retention duration elapses.
  3. The event remains in `status = 'trashed'` indefinitely.
- **Root Cause:**
  `expiry_checker.js` only evaluated public gallery viewing expiration (`public_until < now`), transitioning events from `public` to `private`. It never scheduled or executed cleanup of soft-deleted events in the Recycle Bin past their retention window.
- **Fix:**
  Added automated bin purge routine to `expiry_checker.js`:
  ```javascript
  const expiredBinEvents = db.prepare(`
    SELECT id, name FROM events 
    WHERE status = 'trashed' AND purge_after IS NOT NULL AND purge_after < ?
  `).all(nowIso);
  for (const event of expiredBinEvents) {
    await deleteEventStorage(event.id);
    purgeEventDatabaseRecords(event.id);
  }
  ```
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("automated background job permanently purges expired trashed events").

---

### ISSUE-47-06: Missing Dual Health Probes & Request Tracing
- **Severity:** MEDIUM
- **Affected Component:** `server/index.js`
- **Reproduction Steps:**
  1. Cloud orchestration or load balancer performs liveness (`/api/health`) and readiness (`/api/ready`) probes.
  2. System returns generic 404 or single uninformative response.
  3. Production logs lack end-to-end request correlation IDs (`X-Request-Id`).
- **Root Cause:**
  Lack of decoupled probes distinguishes process liveness from downstream dependency readiness (SQLite query execution + Cloudflare R2 bucket connectivity).
- **Fix:**
  Implemented early UUID `X-Request-Id` generation middleware and dual probes:
  - `GET /api/health`: Lightweight process liveness (`status: "healthy"`, uptime, timestamp).
  - `GET /api/ready`: Deep dependency readiness verifying SQLite query execution and Cloudflare R2/local storage adapter operational status.
- **Verification:**
  Automated integration test in `tests/integration/phase47_production_hardening.test.ts` ("GET /api/health returns 200 with service health status" and "GET /api/ready validates database connectivity and storage status"). Verified via curl and live browser subagent inspection.

---

### ISSUE-47-07: SQLite File Concurrency Lock During Parallel Test Runs
- **Severity:** LOW
- **Affected Component:** `vitest.config.ts`
- **Reproduction Steps:**
  1. Run `npx vitest run` across all 51 test suites in parallel worker threads on Windows.
  2. Multiple workers attempt simultaneous write transactions on `data/photographer.db`.
  3. Intermittent `SQLITE_BUSY` errors and state cross-contamination occur.
- **Root Cause:**
  Vitest default multi-threading file parallelism is unsuitable for single-file embedded SQLite databases without distinct per-worker database isolation.
- **Fix:**
  Configured `fileParallelism: false` in `vitest.config.ts` to ensure serialized suite execution with internal concurrency protection.
- **Verification:**
  Confirmed 100% test pass rate across all 51 test suites without flaky database locking.
