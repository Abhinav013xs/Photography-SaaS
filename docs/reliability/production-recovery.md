# Production Recovery, Economics & Client Data Protection Guide

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  

---

## 1. Production Recovery Architecture & Order of Recovery

In a disaster scenario, services must be brought online in a strict dependency sequence:

```
Step 1: Network & DNS Layer (Cloudflare Edge, TLS Certificates)
   ↓
Step 2: Object Storage (Cloudflare R2 Bucket Connectivity)
   ↓
Step 3: Relational & Vector Database (Neon PostgreSQL Instance)
   ↓
Step 4: AI Face Recognition Microservice (Python FastAPI / YuNet / SFace)
   ↓
Step 5: API Server & Job Queues (Express / Background Queue with recoverStaleJobs)
   ↓
Step 6: Frontend Client Delivery (Vite SPA via Nginx / Express Static)
```

---

## 2. Infrastructure Cost Modeling & Storage Economics

Disaster recovery must not destroy the unit economics of the photography studio. Because Cloudflare R2 charges **$0 egress fees**, storage costs remain predictable:

| Storage Scale | Cloudflare R2 Storage ($0.015/GB/mo) | Neon Database ($19 - $69/mo) | Cold Disaster Snapshot Storage (Backblaze B2 / R2 Archive @ $0.005/GB) | Total Estimated Infrastructure / mo |
| :--- | :--- | :--- | :--- | :--- |
| **100 GB (~10,000 photos)** | $1.50 / mo | $19.00 / mo | $0.50 / mo | **~$21.00 / mo** |
| **500 GB (~50,000 photos)** | $7.50 / mo | $19.00 / mo | $2.50 / mo | **~$29.00 / mo** |
| **1 TB (~100,000 photos)** | $15.00 / mo | $19.00 / mo | $5.00 / mo | **~$39.00 / mo** |
| **5 TB (~500,000 photos)** | $75.00 / mo | $69.00 / mo | $25.00 / mo | **~$169.00 / mo** |
| **10 TB (~1,000,000 photos)** | $150.00 / mo | $69.00 / mo | $50.00 / mo | **~$269.00 / mo** |

*Key Economic Finding:* Storing derived files (thumbnails and previews) in R2 is dramatically cheaper than running continuous secondary live replicas across AWS S3 or Google Cloud, because Cloudflare R2 has zero egress fees when serving client downloads and gallery browsing.

---

## 3. Monitoring & Alerting Requirements

A resilient platform requires automated early warnings before outages impact clients:

1. **Database Connectivity & Pool Saturation:**
   - Alert condition: Active pool connections > 85% for > 2 minutes, or connection timeouts > 3 per minute.
2. **Cloudflare R2 Storage Errors:**
   - Alert condition: HTTP 5xx errors from R2 API > 0.5% of total requests, or probe latency > 1,500ms.
3. **Worker Queue Backlog & Failures:**
   - Alert condition: Media stuck in `processing` > 5 minutes, or queue backlog > 100 items.
4. **Storage Consistency Discrepancy:**
   - Alert condition: `verify-storage-consistency.ts` detects missing storage objects > 0.
5. **Backup Execution Failure:**
   - Alert condition: Daily automated cron snapshot fails to write, SHA-256 generation fails, or backup size drops by > 50%.
6. **Sudden Deletion Spikes:**
   - Alert condition: > 50 media objects deleted within 60 seconds (circuit-breaker triggers to protect against rogue scripts).

---

## 4. Client-Facing Data Protection Summary (Photographer & Client Assurance)

*This section provides clear, transparent language suitable for photographers and their clients regarding data safety:*

> **How Studio Lumina Protects Your Photography & Memories:**
>
> 1. **High-Resolution Master Preservation:** Your high-resolution master photographs and videos are stored in secure, multi-region distributed cloud vaults with 99.999999999% (11 9's) annual durability.
> 2. **Continuous Database Backups:** All event information, ceremony folders, client dates, and gallery preferences are protected by automated daily backups and continuous point-in-time recovery.
> 3. **Accidental Deletion Protection (Recycle Bin):** If an event or photograph is accidentally deleted, it is safely held in your studio's 30-day Recycle Bin and can be restored with a single click.
> 4. **Strict Biometric Privacy:** When guests use "Find My Photos" to search for their pictures, their selfies are processed purely in temporary memory to find matching gallery photos, and are **immediately deleted**. We never keep guest selfies and never create permanent biometric profiles.
> 5. **Tested Disaster Recovery:** All restore procedures and storage consistency checks are verified using automated engineering tests to ensure your photographs remain safe, organized, and recoverable.
