# DESIGN SYSTEM & AESTHETIC GOVERNANCE

**Document Status:** Master Design Principles & Guidelines  
**Tone & Mood:** Fine-Art Editorial, Understated Luxury, Architectural, Restrained  
**Target Medium:** High-DPI Desktop Displays, Tablets, and Mobile Devices  

---

## 1. Design Philosophy: The Anti-AI SaaS Aesthetic
The product must look and feel like an exclusive tool built by an experienced human product designer for a high-end photography studio. It must **NEVER** resemble a generic AI-generated template or standard B2B SaaS dashboard.

### 1.1 Strictly Prohibited Design Tropes
- **No Purple/Blue AI Gradients:** Banned. No neon glowing gradients or "magical AI" tropes.
- **No Excessive Glassmorphism:** Avoid blurry floating blobs and heavily frosted background layers that degrade readability.
- **No Bubbly Cards or Giant Radii:** Avoid oversized pill cards, 32px rounded corners, or childlike toy-like buttons.
- **No Decorative Blobs:** Every layout container must have a clear structural purpose.
- **No Emojis as Primary UI Icons:** Professional stroke iconography (e.g., Lucide React with 1.5px/1.75px stroke) only.

---

## 2. Visual Direction & Atmosphere
- **Inspiration:** Fine-art monographs, Leica galleries, Kinfolk editorial spreads, VSCO, Format, and Pixieset.
- **Atmosphere:** Deep carbon/onyx backgrounds, high photographic contrast, warm champagne bronze accents, and hairline borders that give structure without clutter.

---

## 3. Typography Principles
- **Display / Editorial Serif:** `Cormorant Garamond` (or high-end classical serif) reserved for event titles, studio marks, and hero banners. Provides warmth, timeless romance, and editorial weight.
- **Interface / Sans-Serif:** `Plus Jakarta Sans` or `Inter` for all UI controls, tabular data, metadata labels, inputs, and system navigation. Clean, legible, and balanced at 11px to 16px sizes.
- **Typography Hierarchy:**
  - `Display 1` (Hero Titles): 40px–56px, Serif, line-height 1.15, letter-spacing -0.01em.
  - `Title 2` (Section Titles): 24px–32px, Serif, line-height 1.25.
  - `Body / Standard`: 14px–15px, Sans-Serif, line-height 1.5, regular/medium.
  - `Micro / Metadata`: 11px–12px, Sans-Serif, uppercase, letter-spacing 0.08em–0.12em, muted contrast.

---

## 4. Color System Principles
- **Background Tiers:**
  - `Canvas Background` (`#0a0b0d`): Deep black-carbon foundation, providing true optical contrast for photography.
  - `Panel Surface` (`#111316`): Top navigation, sidebar containers, table headers.
  - `Card Surface` (`#14171b`): Photo cards, interactive modules, dialog surfaces.
  - `Input Surface` (`#121418`): Form inputs and dropzones.
- **Borders & Dividers:**
  - `Hairline Subtle` (`#20242a`): 1px structural separators.
  - `Border Medium` (`#2c323b`): Active container boundaries.
- **Accent Philosophy:**
  - `Champagne Bronze` (`#c5a059`): Primary interactive accent, signifying premium studio craftsmanship without visual noise.
  - `Champagne Subtle` (`rgba(197, 160, 89, 0.12)`): Active tab pills, badge backgrounds.
- **Semantic Status Signals:**
  - `Success / Indexed`: Muted jade/emerald (`#2ec4b6` or `#34d399`).
  - `Warning / Notice`: Terracotta amber (`#e76f51`).
  - `Destructive / Danger`: Soft crimson (`#e63946`).

---

## 5. Spacing, Grid & Layout Principles
- **8-Point Spacing Grid:** All margins, paddings, and component heights adhere to 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px increments.
- **Architectural Radii:** Restrained corners (3px for small chips, 6px for buttons/inputs, 8px for cards, 12px for modals). Never use giant 24px–36px rounded bubble containers.
- **Shadows:** Minimal and deep. Avoid diffused colored glow shadows. Use crisp dark drop shadows (`0 4px 12px rgba(0, 0, 0, 0.6)`).

---

## 6. Component Philosophy: Dual Mode

### 6.1 Photographer Dashboard Philosophy (Productivity-First)
- High information density without feeling cramped.
- Clean metrics, direct status indicators, and immediate actions.
- Drag-and-drop batch uploaders with visible progress meters.
- Fast folder switching and multi-select batch photo actions.

### 6.2 Guest Gallery Philosophy (Photo-First)
- Photography visually dominates 90%+ of the viewport.
- Interface chrome recedes into the background.
- Clean hero banner highlighting client names and event date.
- Fluid responsive masonry photo grid that adapts naturally from mobile screens to 4K displays.
- Fullscreen distraction-free lightbox with subtle navigation arrows and high-res zoom.

---

## 7. Responsive Design Principles
- **Mobile-First for Guests:** Since event guests frequently scan QR codes from physical table cards or reception displays using their smartphones, the guest flow MUST be 100% optimized for mobile viewports (360px to 430px).
- **Desktop Efficiency for Photographers:** Photographers upload thousands of photos and configure settings on laptops and large desktop displays. Provide multi-column workspaces and keyboard shortcuts.

---

## 8. Complete UI State Coverage
Every major interface element must explicitly support:
1. **Default State:** Clean baseline presentation.
2. **Loading State:** Subtle skeleton shimmer or refined spinner.
3. **Empty State:** Thoughtful graphic and actionable prompt (e.g., "No photos in this folder yet").
4. **Success State:** Non-intrusive confirmation feedback.
5. **Error State:** Clear, constructive error message with recovery action.
6. **Disabled State:** Reduced opacity (0.45) with cursor feedback.
7. **Processing State:** Real-time percentage or progress indicator.
8. **Permission Denied / Private State:** Polite notice explaining access restrictions.
9. **Expired State:** Clear explanation of 30-day public window expiry.

---

## 9. Visual QA Requirements
Before marking any UI phase complete:
- Verify alignment, padding consistency, and contrast ratios.
- Test across mobile (375px), tablet (768px), laptop (1280px), and wide (1920px) viewports.
- Confirm that no text wraps awkwardly or overflows containers.
- Ensure all interactive elements have visible hover, active, and focus rings for accessibility.

---

## 10. Implemented Phase 5 UI Foundation & Primitives

### 10.1 Implemented Semantic Color Tokens
Defined in `apps/web/app/globals.css`:
- `--bg-canvas`: `#0a0b0d` (foundation dark carbon)
- `--bg-panel`: `#111316` (sidebar and header panel background)
- `--bg-card`: `#14171b` (interactive card and dialog surface)
- `--bg-input`: `#121418` (form input background)
- `--border-subtle`: `#20242a` (hairline structural 1px border)
- `--border-medium`: `#2c323b` (active container border)
- `--accent-bronze`: `#c5a059` (champagne bronze primary interactive accent)
- `--accent-bronze-hover`: `#b38f49`
- `--accent-bronze-subtle`: `rgba(197, 160, 89, 0.12)`
- `--text-primary`: `#f3f4f6`
- `--text-secondary`: `#9ca3af`
- `--text-muted`: `#6b7280`
- `--status-success`: `#2ec4b6` (muted jade)
- `--status-warning`: `#e76f51` (terracotta amber)
- `--status-destructive`: `#e63946` (soft crimson)

### 10.2 Component Catalog (`apps/web/components/ui/`)
1. **`Button`**: Supports `primary`, `secondary`, `outline`, `ghost`, and `destructive` variants across `sm`, `md`, `lg` sizes. Built-in `isLoading` spinner and disabled state handling.
2. **`Badge`**: Semantic chips with variants: `default`, `bronze`, `success`, `warning`, `destructive`, and `outline`.
3. **`Card`**: Structured card hierarchy: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
4. **`PageHeader`**: Standardized photographer page header with `title`, `description`, `eyebrow`, `actions`, and editorial display serif styling.
5. **`EmptyState`**: Centered aperture graphic, title, descriptive copy, and optional action CTA slot.
6. **`Skeleton` / `SkeletonCard`**: Hardware-accelerated shimmer loaders with customizable height/width for content placeholders.
7. **`ErrorState`**: Error card with accessible alert role, recovery action trigger, and optional full-page layout.
8. **`Modal`**: Accessible dialog primitive featuring `ESC` key handling, backdrop blur, focus trapping, and close trigger.
9. **`Toast`**: Status notification banner with auto-dismiss or manual close.

### 10.3 Dashboard Application Shell (`apps/web/components/dashboard/`)
- **`Sidebar`**: Fixed desktop navigation featuring Studio Lumina brand mark, navigation tabs (`Overview`, `Events Workspace [Phase 6]`, `Storage & R2 [Phase 8]`, `Studio Settings`), active session pulse, and account summary trigger.
- **`Header`**: Top bar providing breadcrumb route navigation, live single-owner session indicator, and mobile drawer trigger.
- **`MobileNav`**: Responsive slide-out navigation sheet on `< md:` screen sizes with touch-friendly navigation links.
- **`AccountModal`**: Displays authenticated studio details, session lifespan (7-day HttpOnly), security standards (Bcrypt 12, Scoped Sessions), and logout button.
- **`SystemHealthCard`**: Subsystem telemetry display querying live `/api/health` diagnostics (PostgreSQL 16 + pgvector, Redis, neural embedding services).

---

## 11. Sharing & QR Modal Design System Specifications (Phase 23)

### 11.1 Sharing Modal Component Hierarchy (`QrModal.jsx` & `ShareModal.tsx`)
The sharing interface delivers an elegant, fine-art editorial presentation for photographer distribution and client communication:
1. **Modal Header:** Champagne bronze aperture/QR icon, crisp title ("Event Share & QR Code"), and subtle close action.
2. **Event Headline:** Display serif typeface (`Cormorant Garamond` / `Georgia`) paired with subdued client and date metadata.
3. **Access State Strip:** High-contrast semantic banners communicating live guest access rules without clutter:
   - **Public:** `#2ec4b6` (Muted Jade) — *"Public Access — Anyone with this link or QR code can view event photos."*
   - **PIN-Protected:** `#c5a059` (Champagne Bronze) — *"PIN Protected — Guests must enter the PIN to unlock photos. (The PIN is never embedded in the QR or link)."*
   - **Private:** `#6b7280` (Muted Slate) — *"Private Gallery — Guests cannot view photos until gallery visibility is set to Public."*
   - **Expired:** `#e76f51` (Terracotta) — *"Gallery Expired — Public access has ended. Republish the event in settings to restore access."*
4. **QR Code Showcase:** Clean, pure white `#ffffff` container with hairline structural border (`1px solid var(--border-medium)`), 16px quiet-zone padding, and high-contrast deep carbon modules (`#0a0b0d`).
5. **Canonical Link Box:** Monospace canonical URL input (`bg-input`) with auto-selection on focus and integrated primary Copy action button with animated check icon feedback.
6. **Action Toolbar:**
   - **Preview Gallery:** Direct navigation link (`target="_blank"`).
   - **Print Sign:** Triggers physical print layout with `@media print`.
   - **SVG:** Downloads scalable vector graphic.
   - **PNG:** Downloads 1000px high-resolution raster graphic.

### 11.2 Print-Friendly Design Token Hierarchy
- `@media print` suppresses all on-screen chrome (navigation bars, modal backdrops, dialog borders, headers, buttons).
- Dedicated `.qr-print-container` renders pure black on white (`#111111` on `#ffffff`) with `max-width: 520px` centered on standard paper.
- Uses `break-inside: avoid` / `page-break-inside: avoid` ensuring the header, high-res QR code, and scan instructions remain uninterrupted on a single physical display page.

