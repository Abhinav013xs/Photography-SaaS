# Backend, Frontend & Worker Reproducible Deployment Guide

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  
**Standard:** 12-Factor App Methodology, Infrastructure as Code  

---

## 1. System Requirements & Runtime Prerequisites

| Subsystem | Requirement | Verified Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Operating System** | Ubuntu 22.04 LTS / Debian 12 / Windows Server | 64-bit | Host environment |
| **Node.js** | Node.js LTS (v20.x or v22.x) | v22.x | Express API, Vite build, Workers |
| **Python** | Python 3.10+ with pip and venv | 3.11+ | OpenCV YuNet & SFace Biometric Microservice |
| **PostgreSQL Client** | `postgresql-client-16` | 16.x | `pg_dump`, `pg_restore`, `psql` |
| **Process Manager** | PM2 or Systemd | PM2 v5+ | Multi-service supervisor and auto-restart |

---

## 2. Environment Variables & Secret Configuration

To rebuild from scratch, populate `.env` in the repository root using the template in `.env.example`:

```bash
# Application Port & URL
PORT=3001
APP_URL=https://gallery.studiolumina.photo
NODE_ENV=production

# Authentication Secret (Minimum 32 random hex characters)
AUTH_SECRET=a8b3c94d8e7f1234567890abcdef1234567890abcdef1234567890abcdef1234

# Neon PostgreSQL Database
DATABASE_URL=postgresql://user:password@ep-host.eu-central-1.aws.neon.tech/photography_saas?sslmode=require
DATABASE_PATH=./data/photographer.db

# Cloudflare R2 Object Storage
R2_ACCOUNT_ID=your_cloudflare_account_id_32_chars
R2_ACCESS_KEY_ID=your_r2_access_key_id_32_chars
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_64_chars
R2_BUCKET_NAME=studio-lumina-bucket
R2_PUBLIC_DOMAIN=https://assets.studiolumina.photo

# Python AI Microservice
AI_SERVICE_URL=http://127.0.0.1:8000
```

---

## 3. Step-by-Step Server Reconstruction Procedure

### Step 1: Clone Repository & Install Node Dependencies
```bash
git clone https://github.com/your-org/photography-saas.git /opt/studio-lumina
cd /opt/studio-lumina
npm ci
```

### Step 2: Setup Python Virtual Environment & AI Dependencies
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/ai/requirements.txt
# Download required neural network model weights (YuNet + SFace)
python3 scripts/download_ai_models.py
```

### Step 3: Run Database Migrations
```bash
# Verify schema state and apply any pending migrations
npx tsx scripts/migrate.ts up
```

### Step 4: Build Frontend Client
```bash
npm --prefix client ci
npm --prefix client run build
```
The compiled SPA assets will reside in `client/dist/`, ready to be served by Express or an upstream Nginx proxy.

### Step 5: Start Production Services via PM2
Use the production PM2 ecosystem configuration:
```bash
# Start all microservices (API, Workers, AI)
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

---

## 4. Worker Recovery & Failure Handling

- **Worker Concurrency:** Configured in `server/services/queue.js` (concurrency = 2).
- **Lease Timeout:** Media processing jobs carry an automatic 5-minute timeout.
- **Auto-Recovery on Reboot:** The queue service runs `recoverStaleJobs()` automatically whenever the Node process starts up. Any orphaned job left in `processing` state during an unexpected restart is evaluated:
  - If source files remain on disk/storage, it is restored to `uploaded` and re-queued.
  - If source files are missing, it is marked `failed` with a clear audit log entry.
