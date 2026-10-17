# Studio Lumina: Production & Release Readiness Checklist (Phase 49)

**Document Version:** 1.0.0 — Production Ready  
**Purpose:** Mandatory pre-flight, deployment, and post-flight verification for all production releases.  

---

## 1. Pre-Flight Verification Checklist (Mandatory Prior to Release)

Before promoting any build to the production environment, the release engineer must verify all items:

- [ ] **Automated Tests Passing:**
  ```bash
  npm test
  ```
  *Requirement: 100% of unit and integration test suites pass with zero failures.*
- [ ] **Static Analysis & Linting:**
  ```bash
  npm run lint
  ```
  *Requirement: Zero lint errors across all TypeScript and JavaScript files.*
- [ ] **Type Integrity Verification:**
  ```bash
  npm run typecheck
  ```
  *Requirement: Zero TypeScript compiler errors across all monorepo workspaces.*
- [ ] **Production Frontend & Asset Build:**
  ```bash
  npm run build
  npm --prefix client run build
  ```
  *Requirement: Full build succeeds without missing imports or dynamic path errors.*
- [ ] **Environment & Secret Audit:**
  ```bash
  npx tsx scripts/validate-env.ts
  ```
  *Requirement: Production secrets configured in `.env.production`; zero secrets checked into Git.*
- [ ] **Git Working Tree Cleanliness:**
  *Requirement: Working branch is `main` or release tag; zero uncommitted scratch files or untracked local credentials.*
- [ ] **Pre-Release Database Snapshot:**
  ```bash
  npx tsx scripts/backup-db.ts
  ```
  *Requirement: Snapshot file created in `backups/` with verified SHA-256 integrity hash.*

---

## 2. Deployment Execution Checklist

- [ ] **Code Deployment:** Pull approved release commit or container image to production host.
- [ ] **Dependency Synchronization:** Run `npm ci --production` to ensure locked dependencies.
- [ ] **Database Migration (if required):** Run migrations and verify schema compatibility.
- [ ] **Service Restart / Reload:** Reload PM2 or container services gracefully (`pm2 reload ecosystem.config.cjs`).
- [ ] **Automated Post-Deployment Smoke Check:**
  ```bash
  npx tsx scripts/production-smoke-check.ts
  ```
  *Requirement: All 5 probes pass (Liveness, Readiness, Queue, DB latency < 50ms, Security headers).*

---

## 3. Post-Deployment Critical Workflow Verification (Smoke Test)

Conduct a manual or automated smoke pass of the 10 core Studio Lumina workflows:

| Step | Workflow | Verification Action | Pass Criteria |
| :--- | :--- | :--- | :--- |
| 1 | **Photographer Auth** | Log in with owner email/password | JWT issued, lands on Dashboard |
| 2 | **Event Creation** | Create event "Production QA Event" | Event slug created, settings persisted |
| 3 | **Batch Photo Upload** | Upload 5 sample high-res JPEG photos | Upload succeeds, thumbnails generated |
| 4 | **AI Face Indexing** | Monitor background queue progress | Status transitions to `ready`, faces indexed |
| 5 | **Guest Gallery View** | Open event public URL in incognito | Editorial grid renders photos cleanly |
| 6 | **Guest PIN Gate** | Test PIN protection if enabled | Correct PIN grants ephemeral guest token |
| 7 | **Find My Photos** | Execute selfie face search | Matches returned in < 100ms; selfie deleted |
| 8 | **Client Proofing** | Favorite and select photos | Selection collection created and updated |
| 9 | **Photo Download** | Download individual photo or ZIP | Pre-signed R2 URL streams cleanly |
| 10| **Recycle Bin & Deletion** | Move photo/event to Bin; restore | Restores cleanly; permanent delete purges R2 |

---

## 4. Post-Release Observation & Sign-Off

- [ ] **Error Log Inspection:** Monitor `pm2 logs api --err` for 15 minutes post-release; verify zero unhandled exceptions.
- [ ] **Queue Drain Verification:** Verify `GET /api/queue/metrics` reports normal queue depth (< 10).
- [ ] **Storage Health:** Run `npx tsx scripts/verify-storage-consistency.ts` to confirm 0 missing objects.
- [ ] **Release Sign-Off:** Release engineer signs off and archives release notes.
