# Neon PostgreSQL Backup, PITR & Disaster Resilience Audit

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  
**Database Engine:** PostgreSQL 16+ with `pgvector` on Neon Serverless Architecture  

---

## 1. Neon Architectural Overview & Capabilities

Neon is a serverless, multi-tenant PostgreSQL platform that separates storage from compute:
- **Neon Storage Engine:** A custom distributed storage architecture based on Log-Structured Merge (LSM) trees and Write-Ahead Logging (WAL) pages stored across multiple Availability Zones in AWS.
- **Compute:** Ephemeral stateless Postgres compute instances that can scale up or down automatically, attaching to storage on demand.
- **pgvector Support:** Full native support for the `vector` extension, enabling high-dimensional indexing (IVFFlat / HNSW) and Euclidean/Cosine similarity searches directly inside Postgres.

---

## 2. Backup Mechanisms & Retention Policy

### 2.1 Point-in-Time Recovery (PITR) & Continuous WAL Archiving
- **How it Works:** Neon continuously streams and persists all PostgreSQL WAL records into its distributed storage layer. Because every transaction is recorded chronologically, the database can be restored to any millisecond within the configured retention window.
- **Default Retention Window:** 
  - Free Tier: 24 hours of continuous history.
  - Launch / Scale Tier (Production): **7 days to 30 days** of continuous PITR history.
- **RPO with PITR:** **Near-zero (< 1 second)** for committed transactions up to the point of disaster.

### 2.2 Instant Database Branching as a Recovery Tool
Neon provides zero-copy database branching in under 2 seconds:
- **Use Case 1 (Non-Destructive Disaster Testing):** Create a branch from production at `T - 10 minutes` to test and inspect data state without interrupting live users.
- **Use Case 2 (Emergency Rollback):** If an accidental batch deletion or destructive migration occurs at `14:32:15`, an engineer can create a new branch from `14:32:00`:
  ```bash
  # Using Neon CLI
  neon branch create --from-time "2026-10-15T14:32:00Z" --name emergency-recovery-branch
  ```
  Updating `DATABASE_URL` to point to the new branch instantly recovers the database without downloading or uploading gigabytes of dumps.

---

## 3. Database Sizing & Capacity Forecasting

| Metric | Current Development / Pilot | 50 Events (~25,000 Photos) | 200 Events (~100,000 Photos) | 500 Events (~250,000 Photos) |
| :--- | :--- | :--- | :--- | :--- |
| **Relational Metadata Size** | ~10 MB | ~150 MB | ~600 MB | ~1.5 GB |
| **Vector Embeddings (`vector(128)`)** | ~5 MB (1,000 faces) | ~120 MB (25,000 faces) | ~480 MB (100,000 faces) | ~1.2 GB (250,000 faces) |
| **HNSW / IVFFlat Vector Indexes** | ~2 MB | ~40 MB | ~160 MB | ~400 MB |
| **Total Database Storage Size** | **< 20 MB** | **~310 MB** | **~1.24 GB** | **~3.1 GB** |
| **Expected Neon Tier** | Free / Launch | Launch ($19/mo) | Launch ($19/mo) | Scale ($69/mo) |

*Key Takeaway:* Because high-resolution original media files are stored externally in Cloudflare R2, the Neon PostgreSQL database remains extremely compact (< 3.5 GB for a quarter-million photographs), making backups fast, inexpensive, and lightweight.

---

## 4. Manual & Automated Recovery Procedures

### 4.1 Procedure A: Neon Web Console PITR Restore
1. Log into the Neon Console at `https://console.neon.tech`.
2. Select the **Studio Lumina** project -> navigate to the **Branches** tab.
3. Click **New Branch** -> select **Time travel / Point in time**.
4. Specify the exact timestamp prior to the incident (e.g. `2026-10-15 14:30:00 UTC`).
5. Name the branch `production-recovery-YYYYMMDD` and click **Create Branch**.
6. Copy the connection string for the new branch.
7. Update `DATABASE_URL` in the production environment variables and restart the API server.

### 4.2 Procedure B: Independent Cold Backup via `pg_dump`
In accordance with the 3-2-1 backup principle, do not rely exclusively on a single provider's proprietary console. Maintain independent automated daily logical dumps:

**Automated Daily Export Script (Cron):**
```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="/var/backups/studio-lumina/db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/studiolumina_dump_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Perform pg_dump with pgvector definitions and gzip compression
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --exclude-table-data='guest_sessions' \
  | gzip > "$FILENAME"

# Generate SHA-256 integrity checksum
sha256sum "$FILENAME" > "${FILENAME}.sha256"

# Retain local snapshots for 30 days
find "$BACKUP_DIR" -type f -name "*.sql.gz*" -mtime +30 -delete
echo "[BACKUP] Successfully created ${FILENAME}"
```

**Restoration from Dump:**
```bash
#!/usr/bin/env bash
set -euo pipefail
DUMP_FILE="$1"
TARGET_DB_URL="$2"

echo "[RESTORE] Verifying SHA-256 checksum..."
sha256sum -c "${DUMP_FILE}.sha256"

echo "[RESTORE] Restoring into target database..."
gunzip -c "$DUMP_FILE" | pg_restore --clean --if-exists --no-owner -d "$TARGET_DB_URL"

echo "[RESTORE] Verifying database integrity and pgvector extension..."
psql "$TARGET_DB_URL" -c "SELECT COUNT(*) FROM events;"
psql "$TARGET_DB_URL" -c "SELECT COUNT(*) FROM face_embeddings;"
echo "[RESTORE] Completed successfully."
```
