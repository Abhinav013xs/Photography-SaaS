# Studio Lumina: Cost Monitoring & Economic Architecture (Phase 49)

**Document Version:** 1.0.0 — Production Ready  
**Scope:** Operating Expenditure (OpEx) Model for Sole-Photographer SaaS Platform  
**Target Studio Workload:** 500+ Events, 10,000–50,000 Photos per event, Millions of platform images  

---

## 1. Executive Cost Summary

Studio Lumina is architecturally optimized to eliminate the catastrophic egress fees and per-API AI licensing charges that plague traditional SaaS applications.

- **Zero Egress Fees:** Delivered via direct integration with Cloudflare R2 object storage.
- **Zero Third-Party AI Fees:** Biometric face detection and embedding generation use local, open-source neural networks (OpenCV YuNet + SFace) running on CPU/worker instances, eliminating expensive per-image cloud vision APIs (e.g. AWS Rekognition, Google Cloud Vision).
- **Embedded Database Efficiency:** High-performance SQLite in WAL mode eliminates multi-hundred-dollar managed database cluster charges.

```
┌────────────────────────────────────────────────────────────────────────┐
│               MONTHLY PRODUCTION EXPENDITURE BREAKDOWN                 │
├───────────────────────────────┬──────────────────────┬─────────────────┤
│ Infrastructure Tier           │ Provider / Service   │ Typical Mo. Cost│
├───────────────────────────────┼──────────────────────┼─────────────────┤
│ Origin Compute Server         │ VPS (2 vCPU, 4GB RAM)│ $10.00 – $15.00 │
│ Primary Object Storage (R2)   │ Cloudflare R2        │ $7.50 – $25.00  │
│ Bandwidth / CDN Caching       │ Cloudflare Edge CDN  │ $0.00 (Free/Pro)│
│ AI Vision & Biometrics Engine │ Local YuNet + SFace  │ $0.00 (Local)   │
│ Database Engine (WAL mode)    │ Embedded SQLite      │ $0.00 (Local)   │
│ TLS Certificates & DNS        │ Cloudflare / Let's E.│ $0.00           │
├───────────────────────────────┴──────────────────────┼─────────────────┤
│ TOTAL ESTIMATED MONTHLY OPERATING COST:              │ $17.50 – $40.00 │
└──────────────────────────────────────────────────────┴─────────────────┘
```

---

## 2. Granular Tier-by-Tier Cost Model

### 2.1 Cloudflare R2 Storage (Direct Photographer Ownership)
Cloudflare R2 charges purely for at-rest storage and read/write operations with **$0 egress fees worldwide**.

| Operation / Resource | Cloudflare Unit Price | 1 TB Event Vault (Typical) | 5 TB Studio Archive (Large) |
| :--- | :--- | :--- | :--- |
| **Storage at Rest** | $0.015 / GB-month | $15.00 / month | $75.00 / month |
| **Class A Operations** (Writes, Lists, Uploads) | $4.50 / million ops | ~$0.45 (100k uploads) | ~$2.25 (500k uploads) |
| **Class B Operations** (Reads, Downloads) | $0.36 / million ops | ~$0.36 (1M views) | ~$1.80 (5M views) |
| **Data Egress** | **$0.00 / GB** | **$0.00** | **$0.00** |

*AWS S3 Comparison:* 5 TB of guest media downloads on AWS S3 would cost approximately **$450/month in egress fees alone**. Under Cloudflare R2, egress is **$0.00**.

### 2.2 Compute & Server Hosting
- **Recommended Host:** Any standard cloud VPS (Hetzner Cloud, DigitalOcean, Linode, or Hostinger VPS).
- **Minimum Specs:** 2 vCPU, 4 GB RAM, 50 GB NVMe SSD.
- **Estimated Cost:** **$10 to $15/month**.

### 2.3 Biometrics & Vector Compute
- Cloud vision APIs charge between $1.00 and $1.50 per 1,000 photo face inspections.
- For a wedding with 5,000 photos, a third-party vision API would cost **$7.50 per event upload**.
- By compiling OpenCV YuNet and SFace directly on the worker node, Studio Lumina incurs **$0.00** in API bills.

---

## 3. Cost Anomaly Defense & Alerting Rules

To protect against unexpected billing surges caused by scraper bots or upload loops, the platform enforces:

1. **Tiered Rate Limiting:**
   - Face search: Max 10 requests per minute per IP.
   - Upload chunks: Max 100 requests per minute per authenticated photographer.
   - Public gallery browsing: Max 120 requests per minute per IP.
2. **Class A Operation Throttling:**
   - The API generates pre-signed URLs with deterministic paths; it does **never invoke repeated `R2:ListObjects`** or `R2:HeadObject` calls during standard gallery views. All metadata is served directly from the local SQLite index.
3. **Budget Alert Thresholds:**
   - **Warning Alert:** Monthly Cloudflare R2 billing exceeds $30.00.
   - **Critical Alert:** Monthly Cloudflare R2 billing exceeds $75.00.
   - Operators configure this alert directly in Cloudflare Dashboard under *Billing > Notifications > Usage-Based Alerts*.
