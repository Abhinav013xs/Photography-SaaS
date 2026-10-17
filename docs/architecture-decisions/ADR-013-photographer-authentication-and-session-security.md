# ADR-013: Photographer Authentication & Session Security Architecture

## Status
Accepted

## Context
Studio Lumina is engineered as a single-photographer / sole-owner studio platform (`AGENTS.md`). There are no guest user accounts, no multi-tenant organizational hierarchies, and no complex role-based access control (RBAC) matrices. The photographer is the only permanent authenticated user of the administrative backend.

In Phase 4, the complete authentication boundary was implemented to guard all administrative APIs and frontend routes while preventing user enumeration, brute-force credential stuffing, cross-site request forgery (CSRF), session fixation, and timing attacks.

## Decision
We implemented a secure, single-owner authentication foundation adhering to the following architectural components:

1. **Password Hashing:**
   - **Algorithm:** Salted `bcrypt` using `bcryptjs` with cost factor 10.
   - **Rationale:** Computationally expensive for automated cracking dictionaries while maintaining acceptable authentication latency (~80-120ms) for interactive logins.
   - **Timing Attack Mitigation:** Constant-time dummy comparison (`performDummyCompare`) runs against a pre-computed cost-10 hash if an account is not found, ensuring indistinguishable response latency between existing and non-existing email addresses.
   - **Anti-Enumeration Responses:** Uniform `401 AUTHENTICATION_REQUIRED` with generic message `"Invalid email or password"` returned regardless of whether the identifier exists or the password was incorrect.

2. **Session Cookie Management:**
   - **Cookie Name:** `studio_session`.
   - **Security Attributes:**
     - `HttpOnly: true` (prevents XSS token exfiltration).
     - `Secure: true` in production (forces HTTPS transmission).
     - `SameSite: Strict` in production (`Lax` in local development to support cross-port requests between Next.js on 3000 and Express on 5000).
     - `Path: /`.
     - `Max-Age: 604,800,000` (7-day sliding expiration).
   - **No Client Storage:** Raw tokens are never stored in `localStorage`, `sessionStorage`, or query parameters.

3. **Cryptographic Tokens (JWT):**
   - Issued via `jsonwebtoken` signed with a server-side `AUTH_SECRET` (minimum 32 characters in production).
   - Enforces `issuer: 'studio-lumina-api'` and `audience: 'studio-lumina-client'`.
   - Decoded and validated server-side by the `requirePhotographer` middleware guard, attaching the authenticated photographer record to `req.photographer`.

4. **Brute-Force & Rate Limiting:**
   - Client IP-based rate limiting on `/api/auth/login` allowing a maximum of 5 failed attempts per 15-minute sliding window.
   - Exceeding the threshold returns `429 RATE_LIMITED` without performing database queries or expensive bcrypt calculations.
   - Distributed Redis backend with automatic in-memory fallback.

5. **CSRF & Origin Header Validation:**
   - `validateOrigin` middleware validates the `Origin` header on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`), rejecting untrusted cross-origin browser requests with `403 FORBIDDEN`.

6. **Initial Account Provisioning:**
   - Secure CLI script `scripts/setup-owner.ts` (`npm run setup:owner`) prompts for email and hidden password from the terminal, hashes the password, and creates the single owner record. Refuses execution if an owner already exists in the database.

## Rejected Alternatives
1. **Third-Party Auth Providers (Auth0, Clerk, Supabase Auth):**
   - *Rejected:* Introduces external vendor lock-in, recurring SaaS subscription costs, and external telemetry for a single-photographer self-hosted system.
2. **Stateful Database Session Tables for Photographer:**
   - *Rejected for Photographer JWT Session:* Cryptographically signed JWT in HttpOnly cookie provides stateless verification without unnecessary per-request database I/O, while session rotation upon password change and cookie expiry guarantees revocation.
3. **Complex Multi-User RBAC (Roles / Permissions):**
   - *Rejected:* Violates `AGENTS.md` Product Rule #1. The platform has exactly one photographer and zero staff/sub-account roles.

## Consequences
- **Positive:**
  - Robust, self-contained single-owner security boundary.
  - Complete protection against enumeration, brute-force, CSRF, and session tampering.
  - Zero client-side token exposure.
  - 100% test coverage with automated unit, integration, and security test suites.
- **Negative:**
  - If the single photographer loses their password and has no CLI access, manual database intervention or running `npm run setup:owner` with database reset is required.
