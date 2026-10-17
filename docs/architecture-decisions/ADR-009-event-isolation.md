# ADR-009: Multi-Tier Event Isolation Architecture

## Status
Accepted

## Context
Event isolation is one of the highest-priority security requirements of the platform. Under no circumstances may an attendee, client, or guest from Event A (e.g., *Rahul & Priya Wedding*) view photos, folders, face embeddings, facial search matches, or storage assets from Event B (e.g., *Corporate Summit*). Frontend filtering alone is completely unacceptable.

## Decision
We enforce a **Mandatory Multi-Tier Event Boundary Architecture** operating simultaneously across five distinct system layers:

```
┌────────────────────────────────────────────────────────┐
│ 1. API Route Layer: Event Context Extraction & Token Match │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Authorization Layer: Strict Event Ownership & Scopes│
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Database Layer: Parameterized SQL WHERE event_id = ? │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. Vector AI Layer: Partitioned Similarity Query        │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 5. Object Storage Layer: Deterministic Key Prefixes     │
└────────────────────────────────────────────────────────┘
```

### 1. API Route Layer
- Route handlers establish the current event context immediately from the verified event slug or route parameter.
- If an endpoint receives a media ID or folder ID, the system verifies that the resource's `event_id` matches the current request's event context before executing any logic.

### 2. Authorization Layer
- **Photographer Requests:** Verifies authenticated photographer ownership.
- **Guest Requests:** Verifies that any provided `X-Guest-Token` JWT contains `token.eventId === request.currentEventId`. Any mismatch triggers immediate `HTTP 403 Forbidden`.

### 3. Database Query Layer
- Every database query accessing folders, media, face embeddings, or download records MUST include the parameter `WHERE event_id = :current_event_id`.
- Example Repository Method:
  ```typescript
  // SECURE: Enforces event boundary directly in SQL
  async getMediaById(mediaId: string, eventId: string): Promise<Media | null> {
    return db.queryOne(
      'SELECT * FROM media WHERE id = $1 AND event_id = $2',
      [mediaId, eventId]
    );
  }
  ```

### 4. Vector Search Layer
- Face search similarity queries NEVER execute against a global vector index and filter downstream in JavaScript.
- The PostgreSQL `pgvector` query enforces the event filter directly at the index execution level:
  ```sql
  SELECT photo_id, 1 - (embedding <=> $selfie_vector) AS score
  FROM face_embeddings
  WHERE event_id = $current_event_id  -- STRICT EVENT BOUNDARY
    AND (embedding <=> $selfie_vector) < 0.38
  ORDER BY embedding <=> $selfie_vector ASC;
  ```

### 5. Object Storage Layer
- Cloudflare R2 object keys are deterministically namespaced: `events/{event_id}/...`.
- Pre-signed URLs generated for media streaming or download strictly specify the target event's prefix.

## Alternatives Considered
- **Frontend Filtering:** Rejected. Catastrophic security vulnerability; any user modifying browser query parameters or inspecting network payloads could harvest private client photographs from other events.

## Consequences
- **Positive:** Zero risk of cross-event leakage; mathematical isolation at the database index layer; compliance with modern biometric and privacy standards.
- **Negative:** Requires developers to always pass `eventId` as a mandatory parameter in all repository queries.
