# Studio Lumina Platform — Production Operations Runbook & Customer Playbook

**Document Classification:** SRE, Reliability & Customer Operations Standard  
**Document Version:** 1.0.0  
**Phase:** 45 (Admin Operations, Customer Support, Audit System, Platform Control Center & Incident Management)  

---

## Part I: System Operational Procedures

### 1. Photographer Login Failures
- **Symptom:** Photographer receives "Invalid credentials" or "Too many failed login attempts".
- **Inspection:** Check `/api/admin/users?search=<email>` in Admin Portal.
  1. Check account `status`. If `suspended`, inspect `suspension_reason`.
  2. If status is `active` and user exceeded 5 attempts, lockout clears automatically after 15 minutes.
  3. If credentials must be reset, update environment password `PHOTOGRAPHER_PASSWORD` or use server-side reset utility.

### 2. Upload Pipeline Failures
- **Symptom:** Photo uploads stall or return HTTP 400/403.
- **Inspection:**
  1. Verify photographer storage quota. If storage is full, account displays `OVER_QUOTA`.
  2. Inspect uploaded file formats: only JPEG, PNG, and WebP are allowed (SVG, HEIC, and non-image binaries are strictly rejected).
  3. Check Cloudflare R2 bucket connectivity via `/api/admin/health`.

### 3. Face Search Degradation / Failures
- **Symptom:** "Find My Photos" modal returns error or no matching candidates.
- **Inspection:**
  1. Navigate to `/admin` $\to$ **Events & Processing**.
  2. Click **Diagnostics** on the target event. Verify `faces_detected` and `embeddings_generated`.
  3. Check if `face_search` feature flag is enabled in **Emergency Controls**.
  4. Verify query selfie: exactly one clear, unoccluded human face is required (group query selfies or zero-face selfies fail validation).

### 4. Background Queue Backlog & Dead-Letter Queue (DLQ)
- **Symptom:** Uploaded photos remain in `processing` status.
- **Action:**
  1. Navigate to `/admin` $\to$ **Queue & DLQ**.
  2. Filter by `dead_letter` and `failed`.
  3. Review `error_category` (`FILE_CORRUPT`, `STORAGE_UNAVAILABLE`, `AI_INDEX_ERROR`, `PROCESSING_TIMEOUT`).
  4. If storage or temporary network timeout was the cause, click **Safe Retry**. The queue resets the job to `pending` and increments `retry_count`.

### 5. Storage Drift & Reconciliation Pass
- **Symptom:** Quota meter does not match physical R2 bucket size.
- **Action:**
  1. Navigate to `/admin` $\to$ **Storage Reconciliation**.
  2. Click **Run Storage Reconciliation**.
  3. The engine compares all database media keys against physical R2 objects and outputs:
     - `missingObjects`: Files in DB but missing in storage.
     - `unexpectedObjects`: Unreferenced files in R2 storage.
     - `orphanRecords`: Media rows without a parent event.
  4. Review discrepancy report. Never delete files without explicit SRE confirmation.

---

## Part II: Common Customer Issue Playbooks

### Playbook 1: "I cannot login to my dashboard"
1. Verify customer email address in `/admin` $\to$ **Photographers**.
2. Check if account is marked `suspended`. If suspended, inform customer of the documented reason.
3. Check if IP rate limit is active. Advise waiting 15 minutes if repeated failed attempts occurred.

### Playbook 2: "My event is not visible to guests"
1. Open `/admin` $\to$ **Events**. Search for event name.
2. Check `status`: if `archived` or in Recycle Bin (`deleted_at` not null), event is hidden from public guests.
3. Check `visibility`: if `private`, guest access is locked. Photographer can switch visibility to `public` in dashboard.
4. Check `public_until`: if 30-day public viewing window has expired, gallery automatically transitions to private. Photographer can republish from dashboard.
5. Check `pin_enabled`: if PIN is enabled, guests must enter the correct PIN.

### Playbook 3: "Photos are still showing 'processing' after upload"
1. Open `/admin` $\to$ **Queue & DLQ**. Filter by event.
2. If job status is `processing`, worker is currently converting WebP previews and extracting YuNet facial landmarks.
3. If job status is `dead_letter`, inspect the error category. If caused by transient timeout, click **Safe Retry**.

### Playbook 4: "Face search isn't finding me in the event"
1. Confirm with customer that event has `face_search_enabled = 1`.
2. Check event diagnostics: verify that photos uploaded have `faces_detected > 0`.
3. Advise guest: query selfie must be well-lit, front-facing, without dark sunglasses or heavy occlusion, and contain exactly one person.

### Playbook 5: "Video is not playing or has no preview"
1. Confirm uploaded video is valid MP4, MOV, or WebM under 500MB.
2. Inspect worker queue for video transcoding: 1080p web-optimized rendition generation takes 30–90 seconds depending on duration.
3. Verify browser video codec support (H.264 / AAC).

### Playbook 6: "My storage shows full / I cannot upload"
1. Check customer's current plan and active add-ons in `/admin` $\to$ **Photographers**.
2. Explain that Recycle Bin items continue consuming physical storage until permanently purged.
3. If eligible for capacity expansion, grant a storage add-on via `/admin` $\to$ **Billing Adjustments**.

### Playbook 7: "I accidentally deleted my event"
1. Check `/admin` $\to$ **Events & Processing**.
2. Events deleted within 30 days reside safely in the **Recycle Bin**.
3. Instruct photographer to click **Recycle Bin** in their top navigation and click **Restore Event**. All folders, photos, videos, and face embeddings will be fully restored.

### Playbook 8: "Payment succeeded but plan did not update"
1. Inspect payment gateway webhook log in server telemetry.
2. Open `/admin` $\to$ **Billing Adjustments**.
3. Select photographer, choose `change_plan`, input verified transaction ID in reason, and apply audited plan override.
