# Studio Lumina — Professional Photography Platform

**System Classification:** Single-Tenant Professional Photography & Biometric Platform  
**Target User:** One Authenticated Professional Fine-Art & Commercial Photographer (Sole Owner)  
**Guest Model:** Zero-Account, Mobile-First, Event-Scoped Guests  
**Phase Status:** **Phase 2 — Project Foundation & Development Environment Complete**  
**Engineering Governance:** Strictly governed by [`AGENTS.md`](./AGENTS.md) and [`docs/PRODUCT_REQUIREMENTS.md`](./docs/PRODUCT_REQUIREMENTS.md)  

---

## 1. Product Overview

Studio Lumina is a bespoke, high-performance photography gallery management and AI-powered biometric face-search platform engineered exclusively for **ONE** professional photographer. It coordinates high-throughput batch uploads directly to Cloudflare R2, asynchronous image derivative and facial embedding generation, relational and vector indexing in PostgreSQL with `pgvector`, and accountless mobile-first guest access via unique QR codes and shareable links.

---

## 2. Technical Architecture

The platform follows a modular, service-oriented architecture:
- **Frontend Presentation Layer (`apps/web`):** Next.js 15 App Router (TypeScript) with custom fine-art design system tokens (Cormorant Garamond display serif, Plus Jakarta Sans interface sans, deep carbon `#0a0b0d`, champagne bronze `#c5a059`).
- **Backend Application Server (`apps/api`):** Node.js (TypeScript) Express server using layered domain-driven services, Zod schema validation, structured JSON logging, and pre-signed S3 URL generation.
- **AI Biometric Inference Tier (`apps/ai`):** Dedicated Python 3.10+ (FastAPI) microservice hosting OpenCV YuNet (face detection) and SFace (face recognition & 128-D vector extraction) in RAM with **Zero Guest Selfie Retention**.
- **Data & Vector Storage Tier (`infrastructure/docker`):** Unified PostgreSQL 16+ instance with the `pgvector` extension for relational data and 128-dimensional dense vector embeddings.
- **Job Broker & Queue Tier:** Redis 7 with BullMQ for partitioned background image processing and maintenance sweeps.
- **Object Storage Tier:** Cloudflare R2 owned directly by the photographer with **$0.00 egress transfer fees**.

Detailed architecture specifications:
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Master Technical Architecture
- [`docs/DATABASE.md`](./docs/DATABASE.md) — Database & Vector Storage Architecture
- [`docs/API.md`](./docs/API.md) — Master API Specification & Domain Contracts
- [`docs/SECURITY.md`](./docs/SECURITY.md) — Security & Biometric Privacy Blueprint
- [`docs/architecture-decisions/`](./docs/architecture-decisions/) — Architecture Decision Records (ADR-001 through ADR-012)

---

## 3. System Requirements

- **Node.js:** v20.x or v22.x+ (v24 LTS supported)
- **npm:** v10.x or v11.x+
- **Python:** 3.10+ (required for AI microservice)
- **Docker & Docker Compose:** Optional for local PostgreSQL + Redis containerization

---

## 4. Repository Structure

```
/
├── apps/
│   ├── web/                    # Next.js 15 App Router frontend application
│   ├── api/                    # Node.js TypeScript Express backend server
│   └── ai/                     # Python 3.10+ FastAPI AI inference microservice
├── packages/
│   ├── config/                 # Typed Zod environment configuration module
│   ├── types/                  # Shared TypeScript interfaces & API envelopes
│   └── errors/                 # Standardized AppError hierarchy
├── infrastructure/
│   └── docker/                 # Docker Compose (PostgreSQL 16 + pgvector, Redis 7)
├── tests/
│   ├── unit/                   # Configuration, AppError, logger, and validation tests
│   ├── integration/            # API health, liveness, readiness, and error tests
│   └── e2e/                    # Playwright browser smoke test setup
├── scripts/                    # Developer CLI tooling (env validation, health probe)
├── docs/                       # Architecture, database, API, and security documentation
├── legacy-prototype/           # Preserved exploratory spike prototype
├── .env.example                # Canonical environment template
├── .gitignore                  # Production Git ignore rules
├── package.json                # Root package with npm workspaces
├── tsconfig.json               # Root strict TypeScript configuration
└── README.md                   # This developer guide
```

---

## 5. Getting Started & Installation

### 5.1 Clone & Install Dependencies
```bash
# Install all workspace dependencies
npm install
```

### 5.2 Configure Environment Variables
Copy the template and populate values:
```bash
cp .env.example .env
```

Validate your configuration:
```bash
npm run env:validate
```

### 5.3 Start Local Infrastructure (Docker)
Start PostgreSQL (with `pgvector`) and Redis:
```bash
npm run infra:up
```

To stop containers:
```bash
npm run infra:down
```

---

## 6. Development Commands

| Command | Action |
| :--- | :--- |
| `npm run dev:api` | Runs the TypeScript backend API server via `tsx` watch mode on port 5000 |
| `npm run dev:web` | Runs the Next.js frontend application on port 3000 |
| `npm run typecheck` | Executes TypeScript type checking across all packages and apps (`strict: true`) |
| `npm run lint` | Runs fast linting via `oxlint` |
| `npm run format` | Deterministically formats all code using Prettier |
| `npm run format:check` | Verifies formatting compliance without writing changes |
| `npm test` | Runs all unit and integration tests via Vitest |
| `npm run test:coverage`| Runs test suite with V8 code coverage report |
| `npm run build` | Compiles production builds across all workspace packages and apps |
| `npm run health` | CLI probe pinging the API and diagnosing subsystem connections |

---

## 7. Python AI Microservice Setup

The Python AI service runs as a persistent local daemon on `127.0.0.1:8000`:
```bash
cd apps/ai
python -m venv .venv

# On Windows:
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check verification:
```bash
curl http://127.0.0.1:8000/health
```

---

## 8. Security & Privacy Rules

- **Zero Biometric Retention:** Raw guest selfies are processed ephemerally in RAM and **immediately destroyed**. They are never persisted to disk, database, or cloud storage.
- **Single Owner:** Only the authenticated photographer has credentials and a dashboard. Guests never register or log in.
- **Strict Event Isolation:** All operations enforce event boundaries across API routes, SQL queries (`WHERE event_id = ?`), vector searches, and R2 key prefixes.
- **Zero Secret Leakage:** R2 credentials, database connection strings, and JWT secrets remain strictly server-side.

---

## 9. Current Phase Status

- **Phase 0:** Master Requirements & Permanent Rules &mdash; **COMPLETED**
- **Phase 1:** Technical Architecture & System Design &mdash; **COMPLETED**
- **Phase 2:** Project Foundation & Development Environment &mdash; **COMPLETED**
- **Phase 3:** Database Architecture & Migrations &mdash; **NEXT (Awaiting Approval)**
