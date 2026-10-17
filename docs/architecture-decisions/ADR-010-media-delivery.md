# ADR-010: Multi-Tier Media Delivery Architecture

## Status
Accepted

## Context
A single professional wedding gallery frequently contains 5,000+ photos amounting to 50 GB to 150 GB of high-resolution RAW/JPEG masters (30MB+ per photo). Serving full-resolution originals to mobile or desktop browsers during normal gallery browsing would cause extreme network congestion, browser crashes, slow rendering, and poor user experience.

## Decision
We select a **Three-Tier Media Delivery Architecture**:

```
┌────────────────────────────────────────────────────────┐
│ 1. Thumbnail Tier (Grid Browsing)                      │
│    • 400px width/height, WebP format (~25KB–35KB)      │
│    • Delivered via Cloudflare CDN with public caching  │
│    • Purpose: Blazing fast 60fps masonry grid rendering│
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Preview Tier (Fullscreen Lightbox Viewing)          │
│    • 1600px width/height, WebP format (~150KB–250KB)   │
│    • Watermarked if event has watermark_enabled = true │
│    • Purpose: Crisp visual appreciation on Retina/4K   │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Original Master Tier (Authorized Downloads Only)    │
│    • Untouched full-resolution original file           │
│    • Clean (non-watermarked) master                    │
│    • Protected via Presigned S3 GET URLs or auth stream│
│    • Purpose: Client printing and archival             │
└────────────────────────────────────────────────────────┘
```

### 1. Grid Asset Delivery
- Photos in the gallery masonry grid exclusively fetch the **Thumbnail WebP derivative** (`events/{event_id}/thumbnails/{filename}.webp`).
- A 1,000-photo gallery consumes only ~30 MB of bandwidth across the entire scroll, enabling sub-second initial paint on 4G/5G mobile devices.

### 2. Lightbox Preview Delivery
- When a guest clicks a thumbnail, the lightbox modal loads the **Preview WebP derivative** (`events/{event_id}/previews/{filename}.webp`).
- If `watermark_enabled` was active during event processing, this preview includes the subtle studio watermark composited into the image.

### 3. Original Download Delivery
- Full-resolution originals are NEVER loaded into `<img>` tags.
- When an authorized guest clicks "Download Photo":
  1. API server checks `events.allow_downloads === true`.
  2. If allowed, API generates a time-limited (15-minute) pre-signed Cloudflare R2 GET URL with `response-content-disposition=attachment; filename="original_name.jpg"`.
  3. Browser downloads the master file directly from Cloudflare R2 with zero server bandwidth consumption and zero egress fees.

### 4. Bulk ZIP Packaging Delivery
- For bulk downloads ("Download All Photos"):
  - Small collections (< 50 photos): Streamed on the fly via Node.js streaming archiver.
  - Large collections (100–5,000 photos): Enqueued to `queue:zip-generation`. The worker streams files from R2 into a temporary ZIP on R2 (`events/{event_id}/exports/{job_id}.zip`), generates a signed download URL, and notifies the client. Temporary ZIPs expire after 24 hours.

## Alternatives Considered
- **Serving Originals Directly in Browser:** Rejected. Severely violates performance guidelines; crashes mobile browsers with out-of-memory errors.
- **On-the-Fly Dynamic Resizing (Image Proxy):** Evaluated, but pre-generating derivatives asynchronously during upload guarantees instant subsequent browsing without dynamic server CPU spikes when 500 guests scan a QR code simultaneously.

## Consequences
- **Positive:** Exceptional browsing speed; mobile data efficiency; zero egress fees; clean separation between browsing assets and printable masters.
- **Negative:** Storage footprint increases by ~8% to store thumbnail and preview WebP derivatives alongside originals.
