# Local Development Infrastructure

This directory provides Docker Compose orchestration for the local data tier:
- **PostgreSQL 16 with `pgvector`** (`pgvector/pgvector:pg16` on port `5432`)
- **Redis 7** with Append-Only File (AOF) persistence (`redis:7-alpine` on port `6379`)

---

## 1. Quick Start

### Start Infrastructure in Background
```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

### Check Container Status & Health
```bash
docker compose -f infrastructure/docker/docker-compose.yml ps
```

### View Live Logs
```bash
docker compose -f infrastructure/docker/docker-compose.yml logs -f
```

---

## 2. Stopping & Resetting

### Stop Containers (Preserving Data Volumes)
```bash
docker compose -f infrastructure/docker/docker-compose.yml down
```

### Reset Infrastructure (Purge Data Volumes & Start Fresh)
```bash
docker compose -f infrastructure/docker/docker-compose.yml down -v
```

---

## 3. Configuration & Ports

| Service | Port | Default Credentials | Connection String |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | `5432` | `postgres` / `postgres` (db: `photography_saas`) | `postgresql://postgres:postgres@localhost:5432/photography_saas` |
| **Redis** | `6379` | None (Local Dev) | `redis://localhost:6379` |

### Verifying pgvector Extension Manually
```bash
docker exec -it studio_lumina_postgres psql -U postgres -d photography_saas -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```
