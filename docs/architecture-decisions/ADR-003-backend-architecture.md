# ADR-003: Backend & API Architecture

## Status
Accepted

## Context
The backend API coordinates relational metadata, asynchronous queues, Cloudflare R2 pre-signed operations, and vector similarity search. The codebase must remain modular and maintainable over years without becoming an unmaintainable "spaghetti" script or drowning in enterprise over-engineering.

## Decision
We select a **Layered Domain-Driven Service Architecture** in TypeScript:

### 1. Structural Layers
```
src/
├── api/
│   ├── middlewares/       # Auth, Guest PIN session, Rate-limit, Request ID, Error handler
│   └── routes/            # HTTP Controllers mapping routes to domain services
├── core/
│   ├── domains/           # Pure business logic per functional domain
│   │   ├── auth/          # Photographer authentication & profile
│   │   ├── events/        # Event CRUD, lifecycle, public window rules
│   │   ├── folders/       # Folder organization & safe deletion logic
│   │   ├── media/         # Upload orchestration, metadata, derivatives
│   │   ├── storage/       # R2 byte calculation, reconciliation, Cloudflare navigation
│   │   ├── guest/         # Public event lookup, PIN verification, temporary sessions
│   │   ├── ai/            # Vector embeddings & face-similarity search orchestration
│   │   └── downloads/     # Single authorized downloads & streaming ZIP packaging
│   ├── repositories/      # Database data access layer (parameterized SQL queries)
│   └── services/          # External infrastructure adapters (R2 Client, Redis/BullMQ, AI Client)
└── shared/
    ├── types/             # Domain entity interfaces & DTO schemas
    ├── errors/            # Standardized AppError hierarchy
    └── utils/             # Crypto, formatting, logging
```

### 2. Request Processing Lifecycle
Every incoming request follows a strict sequential lifecycle:
1. **Request Tracking:** Middleware assigns a unique `X-Request-Id` UUID and attaches it to request context.
2. **Context & Rate Limiting:** Enforces IP rate limits on sensitive endpoints (PIN verification, face search, login).
3. **Authentication / Authorization:**
   - For `/api/dashboard/*`: Verifies photographer JWT session token.
   - For `/api/gallery/*`: Verifies public visibility, 30-day expiry, and event PIN session if PIN-protected.
4. **Input Validation:** Strongly typed schema validation (Zod) validates request body, query parameters, and route parameters.
5. **Domain Service Execution:** Service executes business rules, calls repositories for DB operations, or dispatches asynchronous worker jobs.
6. **Standardized Response:** Returns uniform JSON envelope `{ success: true, data: ... }` or formatted error `{ success: false, error: { code, message } }`.

### 3. Error Handling Hierarchy
```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public isOperational = true
  ) {
    super(message);
  }
}

// Subclasses: UnauthorizedError (401), ForbiddenError (403), NotFoundError (404),
// GalleryExpiredError (410), ValidationError (400), RateLimitError (429)
```

## Alternatives Considered
- **Direct Database Calls in API Handlers:** Rejected. Causes business logic duplication across multiple endpoints, makes testing impossible, and risks inconsistent event isolation checks.
- **Heavy Microservices with Independent Services for Auth, Media, Search:** Rejected. Violates product simplicity rule for a single-photographer system.

## Consequences
- **Positive:** Crystal-clear separation of concerns; high testability; robust input validation; single-tenant simplicity with enterprise-grade internal modularity.
- **Negative:** Slightly more boilerplate files than an inline handler approach.
