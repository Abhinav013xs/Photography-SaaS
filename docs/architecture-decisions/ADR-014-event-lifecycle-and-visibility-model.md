# ADR-014: Event Lifecycle & Visibility Model Architecture

## Status
Accepted

## Context
In Studio Lumina, an **Event** is the foundational organizational container for all photography assets (folders, media, AI face embeddings, guest access tokens, and downloads). Prior to Phase 6, the initial database schema contained basic columns for events, but lacked a formal domain model decoupling **lifecycle states** from **public visibility states**, safe default definitions, and public time window constraints mandated by `AGENTS.md`.

`AGENTS.md` establishes critical rules for events:
1. **Product Rule #4 & #5:** Strict event isolation and a maximum 30-day public viewing period.
2. **Product Rule #6:** Expiry never deletes data; when the public period ends, visibility transitions from `public` to `private`, while all media, folders, and photographer access remain 100% intact.
3. **Product Rule #7 & #8:** Permanent deletion is explicit only. Safe deletion must never orphan storage objects or silently cascade unpredictably.

To maintain architectural integrity, Phase 6 must establish a distinct, resilient lifecycle and visibility model before folder and media subsystems are layered on top in Phases 7–10.

## Decision

We designed and implemented a dual-state domain model decoupling **Lifecycle State** from **Visibility State**:

### 1. Separation of Lifecycle State and Visibility State
- **Lifecycle State (`status` column):**
  - `'draft'`: Newly initialized container undergoing photographer curation. Unlisted and safe from accidental public discovery.
  - `'active'`: Fully prepared event container actively managed by the photographer.
  - `'archived'`: Historical event container retained permanently for photographer records, hidden from default active dashboard views.
  - `'deleting'`: Ephemeral transition state reserved for explicit, confirmed asynchronous purging.
- **Visibility State (`visibility` column):**
  - `'private'`: Default safe state. Inaccessible via any guest route.
  - `'public'`: Permitted for guest access, strictly bounded by a valid `[public_from, public_until]` time window.

Decoupling lifecycle from visibility ensures that archiving an event preserves its configured public dates and protection settings without confounding status flags (e.g. an archived event is not simply "private"; it is archived and retained intact).

### 2. Explicit Safe Defaults on Creation
When an event is created (`POST /api/events`), the system enforces:
- `status`: `'draft'`
- `visibility`: `'private'`
- `allow_downloads`: `false`
- `pin_enabled`: `false`
- `watermark_enabled`: `false`
- `public_from`: `null`
- `public_until`: `null`

A photographer must take deliberate, explicit action (`POST /api/events/:id/publish` or explicit update) to expose an event publicly.

### 3. Maximum 30-Day Public Time Window Enforcement
- In strict adherence to `AGENTS.md` Product Rule #5, when an event's visibility is set to `'public'`, the backend enforces that:
  $$\text{public\_until} > \text{public\_from}$$
  $$\text{public\_until} - \text{public\_from} \le 30\text{ days } (2,592,000\text{ seconds})$$
- Requests with non-chronological dates or windows exceeding 30 calendar days are rejected with `400 BAD_REQUEST` (`PUBLIC_WINDOW_EXCEEDED` / `VALIDATION_ERROR`).
- If an event is updated to `public` without specifying explicit timestamps, the backend applies safe defaults (`public_from = NOW()`, `public_until = NOW() + 30 days`).
- Time calculation is strictly performed in UTC.

### 4. PIN Protection Foundation (Zero Raw PIN Retention)
- PIN protection uses 4 to 8 numeric digits.
- The raw PIN is validated with Zod regex `/^\d{4,8}$/` and immediately hashed server-side using salted `bcrypt` with cost factor 10.
- Stored exclusively in `pin_hash`.
- Raw PIN is never written to disk, database, logs, or API responses.
- The `pin_hash` column is omitted from all JSON serialization outputs (DTOs only expose `pin_enabled: boolean`).
- When `pin_enabled` is updated to `false`, the database clears `pin_hash = NULL`.

### 5. Deterministic Owner Scoping & IDOR Defense
Every event query and mutation enforces:
```sql
WHERE id = :eventId AND owner_id = :authenticatedOwnerId
```
- Client requests cannot specify or spoof `owner_id`; it is derived exclusively from the verified JWT photographer session (`req.photographer.id`).
- Unmatched event lookups return uniform `404 EVENT_NOT_FOUND`, preventing cross-event enumeration and Insecure Direct Object References (IDOR).

### 6. Destructive Deletion Safety (No Premature R2 Claims)
- Cloudflare R2 object storage integration is scheduled for Phase 8.
- To prevent false claims of complete media deletion before R2 pipelines exist, Phase 6 implements:
  1. A required confirmation payload `{ confirmName: "Exact Event Name" }`.
  2. Server-side validation ensuring the typed string matches the event name exactly.
  3. Clean database cascade removal for current database records.
  4. Deletion is restricted to the photographer's explicit consent with clear warnings in the UI.

## Rejected Alternatives
1. **Single Enum Status (`status: 'draft' | 'public' | 'private' | 'archived'`):**
   - *Rejected:* Causes irreconcilable state collisions. If an event expires, changing status from `'public'` to `'private'` loses whether the event was `'active'` or `'draft'`. Archiving would destroy the record of whether the event was published.
2. **Client-Computed 30-Day Window:**
   - *Rejected:* Violates Engineering Rule #3 ("Never Trust Client-Side Authorization"). Tampered client requests could otherwise submit infinite public durations.
3. **Storing Plaintext PINs or Reversible Encryption:**
   - *Rejected:* Security violation. Salted bcrypt prevents unauthorized internal disclosure or database leak exposure.

## Consequences
- **Positive:**
  - Robust, clear separation between gallery preparation (`draft`), live operation (`active`), and permanent retention (`archived`).
  - Guaranteed compliance with the 30-day maximum public availability rule.
  - Complete server-side IDOR protection.
  - Zero biometric or PIN credential leaks.
  - Seamless foundation for Phase 7 (Folders) and Phase 8 (R2 Storage).
- **Negative:**
  - Requires maintaining two state columns (`status` and `visibility`) instead of a single simplified string.
