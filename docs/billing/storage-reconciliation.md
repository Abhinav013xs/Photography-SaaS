# Storage Reconciliation & Object Integrity Architecture

## 1. Executive Summary
In a production photography SaaS, media files and derived renditions exist across two distinct physical and logical systems:
1. **Cloudflare R2 Object Storage**: The physical storage layer holding original high-resolution RAW/JPEG photos, 4K/1080p MP4 videos, WebP previews, and WebP thumbnails.
2. **PostgreSQL Database (`media` & `storage_usage`)**: The logical metadata layer recording ownership, filenames, deterministic object keys, byte counts (`file_size`, `preview_size`, `thumbnail_size`), and aggregated event totals.

Because network partitions, interrupted client uploads, worker processing errors, or out-of-order retries can lead to discrepancies, this platform implements a periodic, automated, and server-authoritative **Storage Reconciliation Process**.

---

## 2. Reconciliation Objectives & Anomaly Detection

The reconciliation system targets four primary classes of storage drift:

| Anomaly Class | Condition | Impact | Automated Resolution |
| :--- | :--- | :--- | :--- |
| **Storage Usage Drift** | `storage_usage.total_bytes != SUM(media.file_size + media.preview_size + media.thumbnail_size)` | Quota meter in photographer dashboard shows slightly inaccurate byte count. | Authoritative sum recalculation via `storageReconciliationService.runStorageReconciliation({ repair: true })`. |
| **Orphaned R2 Object** | Object exists under `events/{event_id}/` in R2 but has no matching row in `media` table. | Dead storage physically in bucket that cannot be displayed to users. | Tagged and purged after a 48-hour safety buffer window (preventing deletion of in-flight uploads). |
| **Missing R2 Object** | Record in `media` with status `ready`, but GET/HEAD request to R2 returns `404 Not Found`. | Guest or photographer attempts viewing/downloading an image that fails to load. | Media record flagged as `failed_missing_r2` and photographer alerted in dashboard. |
| **Object Size Mismatch** | Database declared `file_size` does not match R2 HTTP `Content-Length`. | Storage quota under- or over-estimated. | Database `file_size` updated with authoritative R2 `Content-Length`. |

---

## 3. Reconciliation Schedule & Execution Modes

### A. Real-Time Event-Scoped Reconciliation
Whenever an event undergoes bulk photo deletion or purge from the Recycle Bin, reconciliation runs inline within `eventDeletionService.ts` to ensure R2 prefix purges match deleted database records with zero lingering bytes.

### B. Daily Scheduled Maintenance Sweep
Every 24 hours at 03:00 UTC, a low-priority background worker runs a complete system sweep:
1. Iterates over active events in batches of 50.
2. Sums all media sizes for each event.
3. Compares with `storage_usage`.
4. Re-synchronizes `last_calculated_at` and `total_bytes`.
5. Logs structured metrics to the operational log collector.

### C. On-Demand Administrative Audit
Photographers or admins can trigger an on-demand audit using the API endpoint:
`POST /api/v1/billing/reconcile-storage`

---

## 4. Quota Gate Guarantees
- The upload gate (`assertCanUpload`) evaluates authoritative byte consumption before issuing any presigned upload URL.
- Client-supplied sizes are checked against actual uploaded sizes upon upload confirmation. If a client attempts to upload a 50 MB file while declaring 1 MB, confirmation fails verification.
- Storage counts never drift indefinitely.
