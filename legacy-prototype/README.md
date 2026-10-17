# LEGACY PROTOTYPE ARCHIVE

**Status:** Archived Prototype (Spike Phase)  
**Historical Context:**  
This directory preserves the initial exploratory JavaScript prototype created prior to Phase 1 architectural codification.

### Why this prototype was superseded:
1. **Database Engine:** The prototype utilized local file-based SQLite (`better-sqlite3`), whereas `AGENTS.md` and `docs/ARCHITECTURE.md` (ADR-004) mandate **PostgreSQL 16+ with the `pgvector` extension** for production relational queries and 128-dimensional dense vector similarity search.
2. **Type Safety:** The prototype was written in plain JavaScript, whereas the production architecture mandates **strict TypeScript (`strict: true`)** across all applications and shared packages.
3. **Queue Architecture:** The prototype used an in-memory queue, whereas the production system mandates **Redis + BullMQ** for crash-resilient asynchronous job queues (ADR-005).
4. **AI Biometric Architecture:** The prototype attempted running neural embeddings within Node.js, whereas ADR-007 mandates a dedicated **Python microservice (OpenCV YuNet + SFace)** for sub-80ms native C++ CPU inference and zero-retention ephemeral RAM selfie processing.
5. **Phase Boundaries:** The prototype included early mock dashboard screens and hardcoded seed data, which directly violates Phase 2 boundaries ("NO FAKE DASHBOARD", "NO MOCK PRODUCT DATA").

All code from this spike is preserved in this directory for historical reference and algorithm reuse during subsequent implementation phases (e.g., Phase 11 Sharp pipelines, Phase 23 QR generation).
