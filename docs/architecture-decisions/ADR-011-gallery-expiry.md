# ADR-011: Automated Gallery Expiry Architecture

## Status
Accepted

## Context
Galleries are designed for time-limited public viewing. Photographers provide clients with a public viewing window of up to 30 days. When this window lapses, public guest access must automatically cease. Crucially, public expiry must NEVER result in media loss or database purging; the photographer must retain complete access and the ability to reactivate public viewing at will.

## Decision
We select a **Dual-Layer Backend-Enforced Expiry Architecture**:

```
┌────────────────────────────────────────────────────────┐
│ 1. Scheduled Background Sweeper (Proactive Expiry)     │
│    • Runs via BullMQ cron every 15 minutes             │
│    • Queries: WHERE visibility = 'public'             │
│               AND public_until < NOW()                 │
│    • Updates: visibility = 'private'                   │
│    • Logs: Expiry audit transition                     │
└────────────────────────────────────────────────────────┘
                           AND
┌────────────────────────────────────────────────────────┐
│ 2. Real-Time Request-Time Guard (Reactive Defense)     │
│    • Every guest API handler evaluates:                │
│      if (event.public_until && event.public_until < now)│
│    • Returns: HTTP 410 Gallery Expired immediately     │
│    • Zero window of vulnerability between cron sweeps  │
└────────────────────────────────────────────────────────┘
```

### 1. The 30-Day Hard Upper Bound
- When an event is created or updated to `public`, the frontend provides a duration selector (1 to 30 days).
- The backend strictly enforces:
  ```typescript
  const maxAllowedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (requestedUntil > maxAllowedUntil) {
    throw new ValidationError('Public duration cannot exceed 30 days');
  }
  ```

### 2. Zero Data Loss Guarantee
When an event transitions from `public` to `private`:
- **What Changes:** `events.visibility` becomes `'private'`. Guest access through share links or QR codes is blocked with an informative "Gallery viewing window has expired" screen.
- **What Remains 100% Intact:**
  - Original media, previews, and thumbnails in Cloudflare R2.
  - Ceremony folders and metadata in PostgreSQL.
  - 128-D biometric face embeddings in `face_embeddings`.
  - Photographer dashboard access, viewing, and management tools.
- **Reactivation:** The photographer can re-enable public visibility at any time by selecting a new public duration (up to 30 days).

### 3. Idempotency & Fault Tolerance
- The sweeper query is completely idempotent: running it multiple times consecutively causes zero data corruption or state conflicts.
- If the server restarts or worker queue is temporarily paused, the reactive request-time guard immediately blocks guest access, guaranteeing that expired galleries are never exposed even during maintenance downtime.

## Alternatives Considered
- **Frontend JavaScript Timers:** Rejected. Trivial to bypass by altering client clocks or making direct API requests.
- **Automatic Deletion of Expired Galleries:** Strongly rejected. Catastrophic product flaw; professional photographers need permanent access to archive and re-share client work.

## Consequences
- **Positive:** Mathematically enforced 30-day limit; zero data loss; airtight defense against expired gallery leaks; simple photographer reactivation.
- **Negative:** Requires running a scheduled cron sweeper in BullMQ.
