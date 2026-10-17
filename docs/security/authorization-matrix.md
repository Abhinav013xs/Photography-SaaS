# Granular Resource-Level Authorization Matrix

**System:** Studio Lumina Photography Platform  
**Document Classification:** Master Access Control Specification  
**Author:** Principal Application Security Engineer  
**Security Principle:** Principle of Least Privilege + Strict Fail-Closed Default  
**Date:** October 16, 2026  

---

## 1. Role Definitions

Because the platform is engineered exclusively for a single professional photographer ([AGENTS.md](file:///c:/Users/Abhinav/OneDrive/Desktop/Photography-SaaS/AGENTS.md)), user roles are strictly delimited:

1. **`ROLE_PUBLIC` (Unauthenticated Visitor):**
   - Public internet user with an event URL or QR code.
   - Has entered zero credentials or PINs.
2. **`ROLE_GUEST_LOCKED` (Guest Pending PIN):**
   - Visitor attempting to access a PIN-protected gallery.
   - Has not yet entered the correct 4–8 digit PIN.
3. **`ROLE_GUEST_AUTH` (Authorized Event Guest):**
   - Visitor who scanned the event QR code and entered the valid event PIN (if enabled).
   - Possesses a short-lived, event-scoped JWT session token (`x-guest-token`).
4. **`ROLE_PHOTOGRAPHER` (Master Studio Owner):**
   - Sole authenticated administrator of the platform.
   - Holds an active HTTP-only session cookie issued upon bcrypt password verification.
5. **`ROLE_CROSS_ACTOR` (Malicious / Unauthorized Cross-Owner Actor):**
   - Authenticated user attempting to access or modify resources belonging to another event or owner.

---

## 2. Resource-Level Access Control Matrix

```
Legend:
[ALLOW] = Authorized & Granted
[DENY]  = Prohibited & Fail-Closed (HTTP 401 Unauthorized / HTTP 403 Forbidden / HTTP 404 Not Found)
[COND]  = Conditional on Event Settings (e.g. allow_downloads = true, face_search_enabled = true)
```

| Domain | Resource Action | HTTP Method & Route | `ROLE_PUBLIC` | `ROLE_GUEST_LOCKED` | `ROLE_GUEST_AUTH` | `ROLE_PHOTOGRAPHER` | `ROLE_CROSS_ACTOR` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Auth** | Owner Login | `POST /api/auth/login` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **DENY** |
| **Auth** | Owner Logout | `POST /api/auth/logout` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Auth** | Profile Read / Update | `GET/PATCH /api/auth/profile` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Events** | Create Event | `POST /api/events` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Events** | List Owner Events | `GET /api/events` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Events** | Update Event Settings | `PATCH /api/events/:id` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Events** | Soft Delete to Bin | `DELETE /api/events/:id` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Events** | Permanent Purge | `DELETE /api/events/:id/permanent` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Guest Gallery**| Read Public Event Info | `GET /api/guest/event/:slug` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **DENY** |
| **Guest Gallery**| Verify Event PIN | `POST /api/guest/verify-pin/:slug` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **DENY** |
| **Guest Gallery**| Browse Gallery Media | `GET /api/guest/gallery/:slug/media` | **COND** (Open) | **DENY** (PIN Req) | **ALLOW** | **ALLOW** | **DENY** |
| **Guest Gallery**| Expired Gallery Access | `GET /api/guest/gallery/:slug` | **DENY** (410) | **DENY** (410) | **DENY** (410) | **ALLOW** (Studio) | **DENY** |
| **Guest Gallery**| Private Gallery Access | `GET /api/guest/gallery/:slug` | **DENY** (403) | **DENY** (403) | **DENY** (403) | **ALLOW** (Studio) | **DENY** |
| **Folders** | Create / Rename Folder | `POST/PATCH /api/events/:id/folders` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Folders** | Safe Folder Delete | `DELETE /api/events/:id/folders/:id` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Media** | Authorize Media Upload | `POST /api/storage/upload-url` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Media** | View WebP Thumbnail | `GET /api/media/preview/:id` | **COND** (Open) | **DENY** (PIN Req) | **ALLOW** | **ALLOW** | **DENY** |
| **Media** | Download Original Photo | `GET /api/media/download/:id` | **DENY** | **DENY** | **COND** (Downloads) | **ALLOW** | **DENY** |
| **Media** | Bulk ZIP Download | `POST /api/guest/download-job` | **DENY** | **DENY** | **COND** (Downloads) | **ALLOW** | **DENY** |
| **Biometrics** | Execute Face Search | `POST /api/guest/events/:id/face-search`| **COND** (Open) | **DENY** (PIN Req) | **COND** (Search On) | **ALLOW** | **DENY** |
| **Biometrics** | Direct Vector Read | `GET /api/face-embeddings/:id` | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** |
| **Recycle Bin**| List Trashed Events | `GET /api/events/bin` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Recycle Bin**| Restore Trashed Event | `POST /api/events/:id/restore` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Storage** | View Storage Breakdown | `GET /api/storage/stats` | **DENY** | **DENY** | **DENY** | **ALLOW** | **DENY** |
| **Internal** | Internal AI Indexing | `POST /api/internal/index` | **DENY** | **DENY** | **DENY** | **DENY** (Service Key)| **DENY** |

---

## 3. Enforcement Mechanisms & Fail-Closed Invariants

1. **Authentication != Authorization:**  
   Possessing a valid JWT guest token for Event A strictly denies access to Event B. Middleware checks:
   ```typescript
   if (guestSession.eventId !== requestedEvent.id) {
     throw new ForbiddenError('Guest session token does not belong to this event');
   }
   ```
2. **Private Visibility Trumps Valid PIN:**  
   If an event's visibility is set to `private`, guest access is immediately revoked (`HTTP 403 GALLERY_PRIVATE`). Submitting a valid PIN does **NOT** grant access to a private gallery.
3. **Biometric Confidentiality Invariant:**  
   Raw 128-D vectors are **NEVER** accessible via any public, guest, or photographer API route. The vector distance is evaluated exclusively within PostgreSQL `pgvector`, returning only matched media IDs and similarity scores.
4. **Safe Folder Deletion Invariant:**  
   Deleting a ceremony folder **NEVER** deletes media files. Media records have their `folder_id` updated to `NULL` (Default Pool / All Media) within an atomic database transaction.
