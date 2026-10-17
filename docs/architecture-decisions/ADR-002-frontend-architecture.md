# ADR-002: Frontend Architecture

## Status
Accepted

## Context
The application must deliver two radically distinct user experiences:
1. **Photographer Dashboard:** High-density, professional management environment prioritizing batch uploads, folder re-assignment, processing monitoring, and settings configuration.
2. **Guest Gallery:** Clean, mobile-first, editorial fine-art presentation prioritizing fluid photo display, touch-friendly lightboxes, and instant selfie face-search.

These two user surfaces must never leak code, credentials, or state to each other.

## Decision
We select **Next.js App Router (TypeScript)** with strict route-group segregation and component-level boundaries:

### 1. Route-Group Boundary Segregation
```
app/
├── (photographer)/
│   └── dashboard/
│       ├── layout.tsx         # Enforces photographer auth, sidebar, top navigation
│       ├── page.tsx           # Overview metrics & active jobs
│       ├── events/
│       │   ├── page.tsx       # Events list, search, filter tabs
│       │   └── [id]/          # Event management workspace (folders, grid, settings)
│       ├── storage/           # Cloudflare R2 metrics & billing navigation
│       └── settings/          # Studio branding & password updates
│
├── (guest)/
│   └── gallery/
│       └── [shareToken]/
│           ├── layout.tsx     # Clean editorial chrome, zero photographer controls
│           └── page.tsx       # Hero cover, folder pills, masonry photo grid, lightbox
│
└── api/                       # API routes (REST)
```

### 2. Server vs. Client Component Boundaries
- **Server Components:** Utilized for initial HTML layout, SEO meta tags, and open-graph photography cards for social sharing.
- **Client Components (`'use client'`):** Utilized for interactive feature modules:
  - Drag-and-drop batch uploaders with progress callbacks (`UploadModal.tsx`).
  - Fluid masonry photo grids with virtualized scroll rendering (`PhotoGrid.tsx`).
  - Gesture-friendly lightbox photo viewer with EXIF panel (`PhotoViewer.tsx`).
  - Live webcam capture and face-search scanner (`FaceSearchDrawer.tsx`).

### 3. Styling & Design Tokens
- Strict token-driven design system implemented via custom CSS custom properties (defined in Phase 0: `--bg-primary`, `--accent-primary`, `--font-sans`, `--font-display`).
- Enforces anti-AI design rules: zero neon gradients, zero decorative blobs, no emoji icons.

### 4. Image Loading & Virtualization Strategy
- Grids load lightweight WebP **thumbnails** (max 400px, ~30KB) with native `loading="lazy"` and decoding="async".
- Full-screen lightboxes load high-resolution WebP **previews** (max 1600px).
- Originals are fetched only on explicit, authorized download requests.
- Masonry grid leverages CSS column / grid layout with progressive rendering to guarantee smooth 60fps scrolling across 10,000+ photo collections.

## Alternatives Considered
- **Single Page Application (Pure React Vite) with Client Routing:** Viable, but Next.js App Router offers superior server-side route protection, cleaner code splitting between `/dashboard` and `/gallery`, and native OpenGraph social sharing meta generation for client event links.
- **Multi-Page MPA (Server-Rendered Templates):** Rejected. Would introduce noticeable full-page reloads when navigating folders, filtering photos, or launching the webcam selfie search.

## Consequences
- **Positive:** Clear architectural separation between photographer tools and guest portals; zero chance of guest pages accidentally bundling admin components; fast mobile load times.
- **Negative:** Requires disciplined separation of server and client component logic in Next.js App Router.
