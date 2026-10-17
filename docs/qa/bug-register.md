# Bug Register — Phase 39 End-to-End QA Validation

**Date:** October 15, 2026  
**Auditor:** Principal QA Engineer & Security Automation Specialist  
**Repository:** Photography-SaaS  
**Scope:** Complete Codebase (Functional, E2E, Integration, Biometrics, Edge-Cases)

---

## Summary of QA Bugs & Defects

| Bug ID | Severity | Component | Title | Status |
| :--- | :--- | :--- | :--- | :--- |
| **QA-BUG-01** | **P2 — HIGH** | `server/routes/media.js` | Cross-Event Folder IDOR in Batch Media Movement | **FIXED & VERIFIED** |
| **QA-BUG-02** | **P2 — HIGH** | `server/routes/events.js` | Cross-Event Folder Metadata Modification via Missing Route Param Scoping | **FIXED & VERIFIED** |
| **QA-BUG-03** | **P2 — HIGH** | `server/routes/events.js` | Cross-Event Media Reassignment Vulnerability During Folder Deletion | **FIXED & VERIFIED** |
| **QA-BUG-04** | **P3 — MEDIUM** | `server/routes/guest.js` | Unthrottled Guest Face Search Leading to Inference Worker Resource Exhaustion | **FIXED & VERIFIED** |
| **QA-BUG-05** | **P3 — MEDIUM** | `server/routes/media.js` | Unbounded Batch Operations Exceeding Database Parameter Limits | **FIXED & VERIFIED** |

---

## Detailed Bug Records

### Bug QA-BUG-01
- **Bug ID:** `QA-BUG-01`
- **Title:** Cross-Event Folder IDOR in Batch Media Movement (`PUT /api/media/move`)
- **Severity:** P2 — HIGH
- **Component:** Media Ingestion & Organization Service (`server/routes/media.js`)
- **Environment:** Local / Test / Production API
- **Preconditions:** Authenticated photographer with at least two events (Event A and Event B).
- **Steps to Reproduce:**
  1. Create Event A with Folder A and Photo A.
  2. Create Event B with Folder B.
  3. Send `PUT /api/media/move` with `{"mediaIds": ["photo-A-id"], "targetFolderId": "folder-B-id"}`.
- **Expected Result:** API returns HTTP 400 Bad Request, rejecting cross-event folder reassignment to preserve strict event container isolation.
- **Actual Result:** Previous code reassigned Photo A to Folder B without checking whether Folder B belonged to Event A.
- **Evidence:** Verified during adversarial integration testing; Photo A acquired dangling `folder_id` belonging to Event B.
- **Root Cause:** Missing join/validation between `targetFolder.event_id` and `media.event_id`.
- **Fix:** Added server-side validation ensuring `targetFolder` exists and its `event_id` matches the media's `event_id`.
- **Regression Test:** `tests/integration/audit_phase38.test.ts` & `tests/integration/phase39_e2e_qa_flows.test.ts`
- **Status:** **FIXED & VERIFIED**

---

### Bug QA-BUG-02
- **Bug ID:** `QA-BUG-02`
- **Title:** Folder Metadata Modification Without Event Context Enforcement (`PUT /api/events/:id/folders/:folderId`)
- **Severity:** P2 — HIGH
- **Component:** Event Folder Management (`server/routes/events.js`)
- **Environment:** Local / Test / Production API
- **Preconditions:** Two distinct events exist.
- **Steps to Reproduce:**
  1. Send `PUT /api/events/:eventA/folders/:folderB` with `{"name": "New Name"}`.
- **Expected Result:** Returns HTTP 404 Not Found since Folder B does not exist within Event A.
- **Actual Result:** Route updated folder using `WHERE id = :folderId` without enforcing `event_id = :id`.
- **Evidence:** Captured in integration test asserting compound parameter constraints.
- **Root Cause:** SQL update query omitted the `:id` parameter from the WHERE clause.
- **Fix:** Enforced compound clause `WHERE id = ? AND event_id = ?`.
- **Regression Test:** `tests/integration/audit_phase38.test.ts`
- **Status:** **FIXED & VERIFIED**

---

### Bug QA-BUG-03
- **Bug ID:** `QA-BUG-03`
- **Title:** Cross-Event Media Reassignment on Folder Deletion (`DELETE /api/events/:id/folders/:folderId?targetFolderId=XYZ`)
- **Severity:** P2 — HIGH
- **Component:** Event Folder Deletion (`server/routes/events.js`)
- **Environment:** Local / Test / Production API
- **Preconditions:** Event A and Event B exist; Event A has a folder with photos.
- **Steps to Reproduce:**
  1. Trigger folder deletion on Event A supplying `?targetFolderId=folder-B-id`.
- **Expected Result:** Reassignment rejected with HTTP 400 because `targetFolderId` belongs to Event B.
- **Actual Result:** Photos in Event A were updated to point to a folder in Event B.
- **Evidence:** Cross-event folder leakage detected during lifecycle testing.
- **Root Cause:** Query parameter `targetFolderId` was applied without validating that its `event_id` matched `:id`.
- **Fix:** Validated `targetFolderId` event ownership and scoped media update query with `AND event_id = ?`.
- **Regression Test:** `tests/integration/audit_phase38.test.ts` & `tests/integration/phase39_e2e_qa_flows.test.ts`
- **Status:** **FIXED & VERIFIED**

---

### Bug QA-BUG-04
- **Bug ID:** `QA-BUG-04`
- **Title:** Unthrottled Guest Face Search Leading to Inference Worker Resource Exhaustion (`POST /api/guest/face-search/:slug`)
- **Severity:** P3 — MEDIUM
- **Component:** Guest Face Recognition Router (`server/routes/guest.js`)
- **Environment:** Public Guest Endpoint
- **Preconditions:** Event with face search enabled.
- **Steps to Reproduce:**
  1. Submit rapid, concurrent multipart face search requests using automated script.
- **Expected Result:** Client receives HTTP 429 Too Many Requests after exceeding threshold.
- **Actual Result:** Unlimited requests invoked neural inference (YuNet + SFace), causing CPU and thread pool saturation.
- **Evidence:** Rapid request burst caused CPU spike to 100% on test runner.
- **Root Cause:** Missing rate limiting middleware on guest-facing AI route.
- **Fix:** Implemented sliding-window in-memory rate limiter (max 10 requests/min per IP and event slug) returning HTTP 429 and `Retry-After: 60`.
- **Regression Test:** `tests/integration/audit_phase38.test.ts`
- **Status:** **FIXED & VERIFIED**

---

### Bug QA-BUG-05
- **Bug ID:** `QA-BUG-05`
- **Title:** Unbounded Batch Operations Exceeding Database Parameter Limits (`DELETE /api/media/batch`, `PUT /api/media/move`)
- **Severity:** P3 — MEDIUM
- **Component:** Media Batch Handlers (`server/routes/media.js`)
- **Environment:** Local / Test / Production API
- **Preconditions:** Authenticated photographer.
- **Steps to Reproduce:**
  1. Send batch deletion request with 1,000+ IDs.
- **Expected Result:** Server validates payload array bounds and rejects oversized requests.
- **Actual Result:** Dynamic SQL placeholder expansion `IN (?, ?, ...)` exceeded parameter bounds, triggering driver failure.
- **Evidence:** SQLite host parameter limit error thrown on payloads > 999 items.
- **Root Cause:** Lack of upper-bound validation on `mediaIds` array length.
- **Fix:** Validated `Array.isArray(mediaIds)` and `1 <= mediaIds.length <= 500`. Requests exceeding 500 items receive HTTP 400 Bad Request.
- **Regression Test:** `tests/integration/audit_phase38.test.ts`
- **Status:** **FIXED & VERIFIED**
