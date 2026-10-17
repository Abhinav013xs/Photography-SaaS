# Enterprise Threat Model & Attack Surface Map

**System:** Studio Lumina Photography SaaS Platform  
**Document Status:** Master Security Architecture Threat Model  
**Author:** Principal Application Security Engineer & Cloud Security Architect  
**Evaluation Standard:** STRIDE + OWASP Top 10 + OWASP API Security Top 10  
**Date:** October 16, 2026  

---

## 1. System Overview & Asset Inventory

The platform processes high-resolution photographic and video media alongside sensitive biometric facial embeddings for wedding and commercial client events. The platform is engineered exclusively for **ONE** authenticated photographer/owner, while guests access specific galleries through QR codes or URLs with zero account registration.

### 1.1 Classified Asset Inventory

| Asset Name | Description | Sensitivity Classification | Primary Storage Location | Security Controls |
| :--- | :--- | :--- | :--- | :--- |
| **Guest Selfies** | Temporary guest facial photos submitted for "Find My Photos" | **HIGHLY SENSITIVE (Biometric)** | In-Memory RAM Only | Memory-only buffers, zero disk/DB persistence, immediate GC cleanup |
| **Face Embeddings** | 128-D normalized SFace feature vectors linked to event photos | **HIGHLY SENSITIVE (Biometric)** | Neon PostgreSQL (`face_embeddings` table) | Event-scoped queries (`WHERE event_id = :id`), never exposed via API or logs |
| **Master Photos / Videos**| High-resolution original media assets | **PRIVATE** | Cloudflare R2 (`events/{id}/originals/`) | Pre-signed S3 URLs expiring in 900s, signature validation, no public bucket access |
| **Photographer Credentials**| Master email, bcrypt password hash, session JWT secrets | **HIGHLY SENSITIVE** | Neon PostgreSQL (`photographers` table) | Salted bcrypt (cost 10), HTTP-only SameSite cookies, 24h JWT expiration |
| **Event PINs** | 4–8 digit passcodes protecting client galleries | **PRIVATE** | Neon PostgreSQL (`events.pin_hash`) | Salted bcrypt hashes; raw PIN never stored; 5-attempt rate-limiting lockout |
| **Media Derivatives** | 400px WebP thumbnails and 1600px WebP previews | **INTERNAL / PRIVATE** | Cloudflare R2 (`thumbnails/`, `previews/`) | Signed URLs or edge proxying; access gated by event status & PIN |
| **Gallery Metadata** | Event title, dates, client names, ceremony folder structure | **INTERNAL** | Neon PostgreSQL (`events`, `folders`) | Authorization checks; fail-closed on private/expired events |
| **Storage Credentials** | Cloudflare R2 Access Key ID, Secret Access Key | **HIGHLY SENSITIVE (Secret)** | Server Environment Variables Only | Strictly server-side; excluded from client bundles and masked in logs |
| **Database Connection**| Neon PostgreSQL connection string with password | **HIGHLY SENSITIVE (Secret)** | Server Environment Variables Only | Encrypted transit (`sslmode=require`), restricted host firewall |
| **Application Logs** | JSON event audit records and structured API traces | **INTERNAL** | Server Log Destination | Deep censorship of passwords, PINs, tokens, selfies, and vector embeddings |

---

## 2. Attacker Persona Taxonomy & Threat Capabilities

The security architecture defends against 10 distinct attacker profiles:

```
+-----------------------------------------------------------------------------------------+
|                                    ATTACKER PERSONAS                                    |
+-----------------------------------------------------------------------------------------+
| Persona                         | Access Level               | Attack Objectives        |
+---------------------------------+----------------------------+--------------------------+
| A. Unauthenticated Attacker     | Public Internet / Browser  | Find open galleries, bypass PINs, probe API endpoints |
| B. Normal Guest                 | Mobile Browser / QR Scan   | View legitimate event photos, search own face |
| C. Authenticated Guest (PIN)    | Valid Event Token          | View authorized gallery; attempt horizontal privilege escalation |
| D. Photographer (Sole Owner)    | Authenticated Master User  | Manage own events, folders, media, and studio profile |
| E. Cross-Photographer Attacker  | Authenticated Admin A      | Attempt horizontal IDOR to inspect or delete Admin B's assets |
| F. Malicious Photographer       | Rogue Admin User           | Attempt command injection via EXIF/filenames or SSRF |
| G. Compromised Account          | Stolen Credentials         | Leverage leaked session/token to extract client media |
| H. Automated Bot / Scraper      | High-Concurrency Script    | Brute-force PINs, scrape original media, abuse face search API |
| I. Malicious API Client         | Custom HTTP Tool (curl)    | Manipulate JWT claims, SQL injection, parameter tampering |
| J. Attacker with Leaked ID      | Possesses UUID / R2 Key    | Bypass authorization check using known resource identifier |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Attack Surface Decomposition & STRIDE Matrix

```
                      GUEST / ATTACKER (Browser / Script)
                                      |
                                      v [ENTRY POINT 1: Public HTTP / REST API]
                      +--------------------------------+
                      | Express API / Security Gateway |
                      +--------------------------------+
                       /              |               \
   [ENTRY POINT 2]    /               |                \   [ENTRY POINT 3]
  Cloudflare R2 Media v               v                 v  Neon PostgreSQL
  (Direct Presigned)  +---------------+ +---------------+  (Parameterized Queries)
                      | AI Worker     | | Redis Queue   |
                      | (Python ONNX) | | (Priority)    |
                      +---------------+ +---------------+
```

### STRIDE Threat Evaluation

| Threat Category | Target Subsystem | Attack Vector | Mitigation Control | Residual Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Guest Session | Attacker forges or modifies JWT guest token to claim access to private gallery | Tokens signed with HS256 using server-side 256-bit `JWT_SECRET`; payload contains immutable `eventId` checked on every route | Negligible (Tampered tokens fail signature verification) |
| **Tampering** | Media Upload | Attacker modifies upload parameters to overwrite another event's photos | Pre-signed upload authorizations generate deterministic keys bound strictly to authenticated event: `events/{id}/originals/{uuid}.ext` | Zero (Key path enforced server-side) |
| **Repudiation** | Destructive Action | Photographer or compromised session denies deleting an event or photo | Every destructive action produces an immutable structured audit log entry with `timestamp`, `ownerId`, `eventId`, and `requestId` | Zero (Audit logs persisted) |
| **Information Disclosure** | Biometric Vectors | Attacker intercepts API responses to scrape raw 128-D facial embeddings | API serialization schemas strictly omit `face_embeddings.embedding`; responses contain only matched `mediaId` and `confidence` | Zero (Embeddings never returned via HTTP) |
| **Information Disclosure** | IDOR / BOLA | Attacker changes `eventId` in request body to access unowned event | Middleware verifies `req.params.id === resolvedEvent.id` and validates owner ID against authenticated session | Zero (Strict resource ownership checks) |
| **Denial of Service** | PIN Brute-Force | Automated script attempts all 4-digit PIN combinations (0000–9999) | Redis sliding-window rate limiter locks out IP after 5 failed attempts for 15 minutes (`Retry-After: 900`) | Negligible (Max 5 attempts per window) |
| **Denial of Service** | AI Queue Flooding | Bot submits thousands of face search selfies to starve workers | Rate limiter caps searches to 10 per minute per IP; payload size capped at 10 MB; max 1 face allowed | Low (Absorbed by priority queue backpressure) |
| **Elevation of Privilege** | Guest to Admin | Guest alters JWT payload `role: "guest"` to `role: "photographer"` | JWT signature validation rejects modified claims; photographer routes enforce session cookie verification | Zero (Cryptographic signature check) |

---

## 4. Residual Risks & Operational Controls

1. **Physical Device Theft of Photographer Laptop:**
   - *Risk:* Attacker with unlocked laptop has direct access to dashboard.
   - *Control:* Strict 24-hour JWT session expiration; sensitive settings (password change, permanent deletion) require re-authentication.
2. **Temporary Third-Party Cloudflare Outage:**
   - *Risk:* R2 pre-signed URLs fail to download if Cloudflare edge is partitioned.
   - *Control:* Local disk fallback adapter supported in development and disaster recovery modes.
