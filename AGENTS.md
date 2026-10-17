# AGENTS.md — PERMANENT ENGINEERING & PRODUCT INSTRUCTIONS

> **MANDATORY INSTRUCTION FOR ALL FUTURE AGENTS:**  
> This file contains the permanent engineering, architectural, design, and security rules for this repository. Every coding agent working on this codebase MUST read and strictly adhere to these rules without exception. Never silently alter, bypass, or weaken these directives.

---

## 1. PRODUCT RULES
1. **Single Photographer / Sole Owner:** This platform is engineered for exactly ONE authenticated photographer/owner. Do NOT build multi-tenant accounts, teams, staff sub-accounts, SaaS billing plans, or super-admin dashboards unless explicitly directed in a future project scope.
2. **One Authenticated Dashboard:** Only the photographer has a dashboard, credentials, and access to management tools.
3. **Guests Have Zero Accounts:** Guests do NOT register, do NOT log in, do NOT have user IDs, and do NOT have dashboards. Guest access is strictly event-scoped via QR codes or shareable URLs.
4. **Strict Event Isolation:** Every event is an independent container. Guests from Event A must NEVER access photos, folders, face embeddings, or metadata from Event B. Cross-event leakage is a critical architectural violation.
5. **Maximum 30-Day Public Expiry:** Galleries may only remain public for a maximum of 30 days. The backend must enforce this limit.
6. **Expiry Never Deletes Data:** When a gallery's public viewing period expires, its visibility automatically transitions from `public` to `private`. All photos, videos, embeddings, and photographer access remain 100% intact.
7. **Permanent Deletion is Explicit:** Only explicit photographer action can permanently delete a gallery. Deletion must cleanly purge database records and Cloudflare R2 storage objects to prevent orphaned data.
8. **Safe Folder Deletion:** Deleting a folder must NEVER delete the photos inside it. Photos must be safely reassigned to the default event pool or an alternate folder.

---

## 2. ENGINEERING RULES
1. **Never Fake Backend Functionality:** All endpoints, background jobs, storage operations, and calculations must be real and functional. Do not return hardcoded mock responses or fake data.
2. **Never Expose Secrets to the Frontend:** Storage credentials (Cloudflare R2 Access Keys, Secret Keys), database connection strings, JWT signing secrets, and password hashes must remain strictly server-side.
3. **Never Trust Client-Side Authorization:** Permissions, PIN checks, expiry dates, and download toggles must be enforced on the backend. Frontend UI states are for presentation only.
4. **Use Asynchronous Background Jobs for Heavy Workloads:** Image resizing, video transcoding, neural face detection, vector embedding generation, and bulk ZIP creation must run through worker queues and not block HTTP request/response loops.
5. **Preserve Completed Functionality:** Do not break, overwrite, or silently dismantle previously implemented phases. Verify regressions before declaring a phase complete.
6. **No Unnecessary Dependencies:** Keep the technology stack lean, maintainable, and appropriate for a single-owner application. Avoid unnecessary microservices, service meshes, or enterprise distributed systems.
7. **Test Before Declaring Complete:** Every phase must pass tests, type checks, lint checks, and visual QA before proceeding.

---

## 3. CLOUDFLARE R2 RULES
1. **Direct Photographer Ownership:** Cloudflare R2 is the primary object storage. The photographer owns the Cloudflare account and bucket directly and pays Cloudflare with zero egress fees.
2. **Deterministic Object Keys:** Media keys must adhere to the standard key hierarchy:
   - `events/{event_id}/originals/{filename}`
   - `events/{event_id}/previews/{filename}`
   - `events/{event_id}/thumbnails/{filename}`
   - `events/{event_id}/videos/{filename}`
3. **No Fake Storage Plans:** Never invent arbitrary storage quota tiers (e.g., 50GB, 100GB, 500GB). Display actual, measured byte consumption.
4. **No Unsupported Cloudflare APIs:** Do not invent fictitious Cloudflare billing APIs. Provide clear metrics and direct links to the Cloudflare dashboard and billing page.
5. **Pre-Signed URLs for Secure Delivery:** Deliver media via signed URLs or secure proxy streams; never expose private storage credentials to browsers.

---

## 4. AI & BIOMETRIC RULES
1. **Real Neural Face Embeddings:** Face detection and recognition must utilize real deep-learning models (e.g., OpenCV YuNet + SFace producing 128-D normalized embeddings).
2. **Event-Scoped Vector Search:** All similarity searches (`Find My Photos`) must enforce `WHERE event_id = :current_event_id` at the database/vector query layer.
3. **Group Photo Matching:** If a guest matches ANY detected face in a group photo, the complete group photo must be returned.
4. **Zero Guest Selfie Retention:** Guest selfies are sensitive biometric data. They must be processed ephemerally in RAM or temporary scratch files, converted to an embedding vector, and **immediately destroyed/deleted**. Never persist raw guest selfies.
5. **Calibrated Match Thresholds:** Cosine distance and similarity thresholds must be grounded in real model benchmarks (e.g., SFace cosine similarity >= 0.60 to 0.65), not arbitrary guesses.

---

## 5. SECURITY RULES
1. **Input Validation:** Validate all input parameters, file mime-types, file sizes, and request bodies on the server.
2. **PIN Protection & Rate Limiting:** Event PINs must be hashed using salted bcrypt. Repeated failed attempts must trigger IP rate-limiting to prevent brute force attacks.
3. **Temporary Guest Sessions:** Successful PIN entry grants an ephemeral signed token (JWT) scoped strictly to that specific event ID.
4. **Injection & Vulnerability Prevention:** Protect against SQL injection (use parameterized queries), XSS, CSRF, and path traversal during file uploads and downloads.

---

## 6. DESIGN SYSTEM RULES
1. **No AI Design Clichés:** The UI must NOT look like a generic AI-generated template. Avoid purple/blue AI gradients, excessive glassmorphism, giant bouncy cards, pill containers everywhere, emojis as icons, and decorative blobs.
2. **Editorial Fine-Art Aesthetics:** Design with the elegance of high-end photography publications (VSCO, Leica, Pixieset). Use deep carbon tones (`#0a0b0d`), warm champagne bronze accents (`#c5a059`), crisp 1px borders, and refined typography (Plus Jakarta Sans + Cormorant Garamond).
3. **Mobile-First for Guests:** Guest galleries will primarily be scanned via mobile QR codes. The mobile experience must be fast, photo-focused, and touch-optimized.
4. **Complete UI States:** Every UI element must support Default, Loading, Empty, Success, Error, Disabled, Processing, and Expired states.

---

## 7. FUTURE PHASE EXECUTION WORKFLOW
Every future phase must execute strictly using the following 17-step protocol:
1. Read `docs/PRODUCT_REQUIREMENTS.md`.
2. Read `AGENTS.md`.
3. Read relevant documentation in `docs/`.
4. Inspect the existing implementation in the workspace.
5. Identify dependencies and prerequisites.
6. Create an implementation plan artifact.
7. Implement ONLY the requested phase.
8. Run automated tests.
9. Run type checking.
10. Run linting.
11. Run the application locally.
12. Browser-test UI features where applicable.
13. Perform visual QA on rendered interfaces.
14. Fix any discovered bugs or UI regressions.
15. Verify that previously built functionality remains intact.
16. Report completion and test results.
17. **STOP.** Never automatically start the next phase without explicit user approval.
