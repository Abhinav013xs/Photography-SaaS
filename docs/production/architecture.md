# Production Architecture & Failure Isolation Blueprint

**System Name:** Studio Lumina Photography Platform  
**Target Environment:** Dedicated Single-Owner Cloud Infrastructure  
**Author:** Principal Site Reliability Engineer & Production Infrastructure Architect  
**Status:** Certified Architecture Documentation  
**Date:** October 15, 2026  

---

## 1. Architectural Overview & Component Map

The Studio Lumina Photography Platform is engineered around strict **workload isolation**, **stateless horizontal compute**, and **direct edge media offload**. No large binary media streams through the API application servers. Heavy neural facial inference executes asynchronously without blocking interactive gallery browsing or photographer management.

```
                                  PHOTOGRAPHER & GUESTS
                                            |
                                            v
                              +---------------------------+
                              |   Cloudflare Edge Network |
                              | (DNS, Strict TLS 1.3, CDN)|
                              +---------------------------+
                               /            |            \
           Static Web Assets  /             |             \  Direct Media Uploads
                             v              |              \ & Downloads (S3 Presigned)
                   +-----------------+      |               v
                   | Vite React SPA  |      |      +-----------------+
                   | (Edge Cached)   |      |      |  Cloudflare R2  |
                   +-----------------+      |      |  Object Storage |
                                            v      +-----------------+
                               +-------------------------+
                               |  Ingress Load Balancer  |
                               | (Nginx / Cloudflare LB) |
                               +-------------------------+
                                            |
                     +----------------------+----------------------+
                     |                      |                      |
                     v                      v                      v
              +--------------+       +--------------+       +--------------+
              |  API Node 1  |       |  API Node 2  |       |  API Node N  |
              | (Stateless)  |       | (Stateless)  |       | (Stateless)  |
              +--------------+       +--------------+       +--------------+
                     |                      |                      |
                     +----------------------+----------------------+
                                            |
                 +--------------------------+--------------------------+
                 |                                                     |
                 v                                                     v
      +----------------------+                              +----------------------+
      |   Neon PostgreSQL    |                              |   Redis Work Queue   |
      | (pgvector HNSW Index)|                              | (BullMQ 4 Lanes)     |
      +----------------------+                              +----------------------+
                 |                                                     |
                 | Transactional & Vector Metadata                     v
                 |                                          +----------------------+
                 +------------------------------------------|  Python AI Workers   |
                                                            |   (YuNet + SFace)    |
                                                            +----------------------+
```

---

## 2. Component Inventory, Dependencies & Recovery Matrices

### 2.1 Component Detail Matrix

| Component | Technology | Primary Purpose | Dependencies | Failure Impact | Recovery Method |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Edge & CDN** | Cloudflare Enterprise/Pro Edge | TLS termination, DDoS defense, static asset caching, direct media proxying | Cloudflare Network | **Total platform unavailability** if DNS fails | Cloudflare multi-region edge redundancy, automatic Anycast routing |
| **Frontend Web** | React 18, Vite 8, Tailwind/Vanilla CSS | Single Page App for photographer dashboard and guest mobile galleries | Cloudflare Edge, API Nodes | **Client interface unavailable** | Static SPA deployment to Cloudflare Pages/S3; instant instant rollback via atomic commit hash deployment |
| **API Servers** | Node.js v22 LTS, Express, TypeScript | RESTful routing, authentication, authorization, session management, signed URL issuance | Database, Redis, R2 credentials | **Degraded service / HTTP 502** if all nodes fail; zero impact if one of multiple nodes fails | Multi-node cluster managed by PM2/Systemd/Docker; automatic health check restart (`/health/live`), horizontal load balancing |
| **Primary Database** | Neon Serverless PostgreSQL | ACID relational store for events, folders, media metadata, guest sessions | Neon Cloud, AWS us-east-1 storage engine | **Read/Write operations blocked**; guest gallery reads fail closed | Automated Neon multi-AZ replication, daily encrypted snapshots (`scripts/backup-db.ts`), point-in-time recovery (PITR) |
| **Vector Engine** | pgvector with compound HNSW indexes | 128-D cosine distance facial similarity indexing (`vector_cosine_ops`) | Neon PostgreSQL | **AI face searches fail**; regular gallery browsing and downloads remain fully operational | Rebuilt deterministically from stored `face_embeddings` table; fallback to sequential event scan if index corrupts |
| **Object Store** | Cloudflare R2 | Storage of original photographs, video MP4s, thumbnail/preview WebP derivatives | Cloudflare Storage Fabric | **Media upload and download blocked**; metadata browsing intact | Multi-region durable object replication; deterministic key paths (`events/{id}/...`); nightly consistency audit |
| **Work Queue** | Redis (BullMQ) + In-Memory Fallback | Asynchronous task queues for thumbnail generation, video transcoding, ZIP builds | Redis service | **Background processing pauses**; jobs buffer safely in memory or queue | Queue persistence to disk (AOF/RDB); automatic job reconciler resumes pending tasks upon reconnect |
| **AI Workers** | Python 3.11+, OpenCV YuNet, SFace | Neural face detection and 128-D normalized embedding generation | CPU / RAM, Model weights | **Face search indexing pauses**; HTTP API continues serving normal requests | Decoupled worker pool; crashed processes auto-restarted by supervisor; stuck jobs reclaimed after lease timeout |

---

## 3. Single Point of Failure (SPOF) Audit & Classification

Every system component has been evaluated for single points of failure. Components are classified into three operational categories:

```
[CRITICAL SPOF]  ---> Immediate platform outage if lost; requires automated multi-node or cloud redundancy.
[IMPORTANT SPOF] ---> Secondary degraded functionality; non-critical workflows temporarily paused.
[ACCEPTABLE SPOF]---> Single fine-art studio profile; downtime during disaster drill is within agreed SLA.
```

### 3.1 Critical Failures (Must Have Redundancy)

1. **Neon PostgreSQL Database:**
   - **Classification:** `CRITICAL`
   - **Failure Scenario:** Compute instance termination or availability zone network partition.
   - **Mitigation:** Neon provides built-in multi-AZ serverless storage architecture. Compute auto-restarts within 2–5 seconds upon failure. Connection pooling (`PgBouncer`) absorbs reconnect bursts.
2. **Cloudflare DNS / Edge:**
   - **Classification:** `CRITICAL`
   - **Failure Scenario:** DNS hijacking or Cloudflare edge routing outage.
   - **Mitigation:** DNSSEC enabled; secondary backup NS records configured with zero-TTL failover.

### 3.2 Important Failures (Gracefully Degraded)

1. **Redis Queue System:**
   - **Classification:** `IMPORTANT`
   - **Failure Scenario:** Redis node crash or OOM termination.
   - **Mitigation:** API implements an in-memory queue fallback for interactive workflows. Photo uploads store their originals in R2 and mark DB status as `uploaded`; worker reconciler claims unprocessed media upon Redis revival.
2. **AI Worker Pool:**
   - **Classification:** `IMPORTANT`
   - **Failure Scenario:** Python process segmentation fault or OpenCV thread crash.
   - **Mitigation:** Workers are isolated out-of-process. Job leases expire after 300 seconds; `jobRecoveryService.ts` automatically reclaims stranded jobs and assigns them to surviving workers.

### 3.3 Acceptable Risks (Single-Photographer Architecture)

1. **Single Studio Owner Account:**
   - **Classification:** `ACCEPTABLE`
   - **Rationale:** By product design ([AGENTS.md](file:///c:/Users/Abhinav/OneDrive/Desktop/Photography-SaaS/AGENTS.md)), the platform serves exactly ONE authenticated photographer. Multi-tenant cluster sprawl is explicitly prohibited.
   - **Mitigation:** The photographer credentials and Argon2id/bcrypt password hashes are securely stored in the database with automated daily offline encrypted backups.
2. **Cloudflare R2 Regional Storage:**
   - **Classification:** `ACCEPTABLE`
   - **Rationale:** 11 nines of data durability (99.999999999%) provided natively by Cloudflare R2 with $0 egress fees.
   - **Mitigation:** Nightly consistency check (`scripts/verify-storage-consistency.ts`) detects any missing storage objects.

---

## 4. Production Environment Separation

Strict environment isolation is enforced across code, configuration, and data tiers:

```
+--------------------+------------------------+------------------------+
| Dimension          | Development / Staging  | Production             |
+--------------------+------------------------+------------------------+
| Host Environment   | Local / GitHub Actions | Dedicated VPS / Cloud  |
| Database Engine    | pg-mem / Local SQLite  | Neon Managed Postgres  |
| Storage Engine     | Local Mock / Scratch   | Cloudflare R2 Bucket   |
| NODE_ENV           | 'development' / 'test' | 'production'           |
| CORS Policy        | Permissive (localhost) | Strict (config.appUrl) |
| Error Details      | Verbose stack traces   | Censored API envelopes |
| Token Expiration   | Extended / Mock        | Strict 24h JWT / 15m PIN|
+--------------------+------------------------+------------------------+
```

### Credentials & Secrets Boundary Rules
1. **Zero Secret Leakage in Client Bundles:** Frontend code contains zero API keys, database connection strings, or R2 credentials. All Vite environment variables are prefixed with `VITE_PUBLIC_` and validated during CI build.
2. **Server-Side Secret Hygiene:** Storage credentials (`CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`), Neon connection strings (`DATABASE_URL`), and session secrets (`JWT_SECRET`) reside exclusively in encrypted server environment files with `chmod 600` file permissions.
3. **No Cross-Environment Access:** Test credentials are mathematically incapable of accessing production Neon clusters or production R2 buckets.
