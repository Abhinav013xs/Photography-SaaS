# Studio Lumina Photography SaaS — Production Cost & Growth Model

**Author:** Antigravity Autonomous Principal SRE & Cloud Infrastructure Architect  
**Document Version:** 1.0.0  
**Target Architecture:** Single-Owner Professional Photography SaaS  
**Infrastructure Providers:** Cloudflare (Edge, Pages, R2), Neon (Serverless PostgreSQL + pgvector), Compute (Node.js API + Python AI Worker)

---

## 1. Executive Summary & Cost Philosophy

The Studio Lumina platform is deliberately architected for **zero egress fees**, **serverless auto-scaling**, and **direct cloud offloading**. By using Cloudflare R2 instead of AWS S3, the photographer eliminates the single largest cloud cost risk: guest download bandwidth.

### Key Architectural Cost Drivers:
1. **$0 Egress Fees:** Cloudflare R2 charges **$0.00 per GB** for data egress, making mass guest downloads virtually free from transfer fees.
2. **Deterministic Pre-Signed URLs:** Clients upload and download directly to/from R2. The Node.js API server never proxies heavy media binaries, keeping compute CPU and RAM footprints lean.
3. **Event-Scoped 30-Day Public Expiry & Lifecycle Deletion:** Public access automatically closes after 30 days. Media moved to the Recycle Bin is automatically purged after 30 days, preventing runaway storage bloat.
4. **Serverless Neon PostgreSQL with pgvector:** Auto-suspends compute during photographer idle periods and scales during active wedding/event gallery viewing.

---

## 2. Infrastructure Component Unit Pricing (2026 Reference)

| Service / Resource | Provider | Unit Pricing Rate | Free Tier / Baseline Inclusions |
| :--- | :--- | :--- | :--- |
| **Frontend Static Hosting** | Cloudflare Pages | $0.00 / mo | Unlimited bandwidth, global edge CDN, automated TLS |
| **Object Storage (Media)** | Cloudflare R2 | **$0.015 / GB-month** | First 10 GB/month free |
| **R2 Class A Ops (Uploads/Lists)** | Cloudflare R2 | **$4.50 / 1,000,000 requests** | 1,000,000 requests/month free |
| **R2 Class B Ops (Downloads/Reads)**| Cloudflare R2 | **$0.36 / 1,000,000 requests** | 10,000,000 requests/month free |
| **Egress Bandwidth** | Cloudflare R2 | **$0.00 / GB** (Zero Egress) | Always 100% Free |
| **PostgreSQL Database + pgvector** | Neon Serverless | $0.16 / Compute Unit-hr; $0.000164 / GB-hr storage (~$0.12/GB-mo) | 0.5 CU baseline, 3 GB storage included free |
| **Redis Queue Broker** | Upstash / Managed Redis | $0.20 / 100k commands | 10,000 commands/day free (~$0 to $5/mo) |
| **API & AI Compute (Containers)** | Dedicated VPS / Fly.io / Hetzner | $5.00 – $25.00 / mo (1-2 vCPU, 2-4GB RAM) | Fixed predictable compute footprint |
| **Observability & Logging** | Structured JSON logs / Sentry | $0.00 (Self-hosted or Developer tier) | 5,000 errors/month free |

---

## 3. Storage Growth Model per Event

### 3.1 Event Assumptions (Standard Wedding / High-End Event)
- **Original Photos Uploaded:** 800 photos (Average high-res JPEG/WebP: 8 MB)
- **Derivative Previews (1920px WebP):** 800 images (~450 KB each)
- **Derivative Thumbnails (400px WebP):** 800 images (~45 KB each)
- **Video Clips:** 5 4K/1080p clips (Average size: 120 MB each)
- **Faces Detected & Indexed:** ~2,400 faces (128-D SFace embeddings in pgvector: ~512 bytes per face)
- **Database Row Overhead:** ~2 MB metadata per event

### 3.2 Storage Breakdown per Event:
$$\text{Original Photos} = 800 \times 8\text{ MB} = 6.4\text{ GB}$$
$$\text{Previews} = 800 \times 0.45\text{ MB} = 0.36\text{ GB}$$
$$\text{Thumbnails} = 800 \times 0.045\text{ MB} = 0.036\text{ GB}$$
$$\text{Videos} = 5 \times 120\text{ MB} = 0.60\text{ GB}$$
$$\mathbf{\text{Total R2 Storage per Event}} \approx \mathbf{7.4\text{ GB}}$$
$$\mathbf{\text{Database Storage per Event}} \approx \mathbf{3.5\text{ MB}}$$

---

## 4. Scaled Cost Projections (100 to 10,000 Active Guests)

The following models estimate cumulative monthly operational costs based on active events and monthly guest viewing/download volumes:

| Scale Tier | Active Events | Monthly Active Guests | Total Stored Media (R2) | Monthly Egress Data | Compute & DB Cost | R2 Storage & Ops Cost | **Total Estimated Monthly Cost** |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100 Guests** | 1 Event | 100 | ~7.4 GB | ~50 GB | $5.00 (Shared VPS) + $0.00 (Free Neon) | $0.00 (Within R2 Free Tier) | **$5.00 / month** |
| **500 Guests** | 3 Events | 500 | ~22.2 GB | ~250 GB | $10.00 (VPS) + $1.50 (Neon) | $0.18 (Storage) + $0.02 (Ops) | **$11.70 / month** |
| **1,000 Guests** | 6 Events | 1,000 | ~44.4 GB | ~600 GB | $12.00 (VPS) + $3.00 (Neon) | $0.52 (Storage) + $0.05 (Ops) | **$15.57 / month** |
| **5,000 Guests** | 20 Events | 5,000 | ~148.0 GB | ~3,500 GB | $20.00 (VPS) + $8.00 (Neon) | $2.07 (Storage) + $0.35 (Ops) | **$30.42 / month** |
| **10,000 Guests**| 40 Events | 10,000 | ~296.0 GB | ~8,000 GB | $30.00 (Dedicated) + $15.00 (Neon) | $4.29 (Storage) + $0.85 (Ops) | **$50.14 / month** |

> [!NOTE]
> On legacy platforms like AWS S3 where egress costs \$0.09/GB, delivering 8,000 GB of downloads would incur **\$720.00 in bandwidth charges alone**. On Studio Lumina, Cloudflare R2 egress is **\$0.00**, saving the photographer over \$700/month at peak scale.

---

## 5. Database Growth Model

| Table Entity | Growth Rate per 10 Events | 100 Events (1 Year) | Indexing Overhead (HNSW / B-Tree) | Growth Risk Level |
| :--- | :--- | :--- | :--- | :---: |
| `events` | 10 rows | 100 rows | < 1 MB | Minimal |
| `folders` | ~40 rows | 400 rows | < 1 MB | Minimal |
| `media` | ~8,000 rows | 80,000 rows | ~15 MB | Low |
| `face_embeddings` | ~24,000 rows (128-D) | 240,000 rows | ~160 MB (HNSW cosine index) | **Medium (Primary DB Driver)** |
| `processing_jobs` | ~8,100 rows | 81,000 rows (auto-pruned) | ~10 MB | Low |
| `audit_logs` | ~5,000 rows | 50,000 rows | ~8 MB | Low |

### Growth Conclusion:
At 100 large events (80,000 photos, 240,000 indexed faces), the entire PostgreSQL database including vector indices occupies **< 250 MB**, remaining well within basic serverless compute and RAM tiers.

---

## 6. Retention-Based Deletion Savings

Comparing perpetual data retention versus automated lifecycle policies:

| Retention Policy | 3-Year Storage Volume | 3-Year Cumulative R2 Cost | Security & Privacy Exposure |
| :--- | :--- | :--- | :--- |
| **Keep Everything Forever** | ~2.2 TB | ~$1,188.00 | High biometric liability, obsolete client archives |
| **30-Day Public Expiry + 6-Month Archive Purge** | ~350 GB (Active pool only) | ~$189.00 | **Minimal (GDPR/BIPA compliant, 84% cost reduction)** |

---

## 7. Operational Recommendations for Production
1. **Enable Cloudflare Web Analytics (Free):** Monitors public page view trends with zero tracking scripts or privacy consent requirements.
2. **Automated Weekly DB Vacuuming:** Ensure Neon Postgres HNSW indices are re-indexed during off-peak hours (scheduled weekly via cron).
3. **R2 Class A Batching:** Bulk uploads use multipart presigned URLs in batches of 50 to minimize Class A billable requests.
