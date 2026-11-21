# Umamusume Live Wiki — Design System & Frontend Specification

> Authoritative design and engineering contract for all human and AI contributors. Every new page, component, or theme variant MUST follow these rules to maintain visual coherence and kinetic craft.

---

## 1. Dual-Theme Architecture

The site operates on a single semantic token layer ([tokens.css](uma_tools/frontend/styles/tokens.css)):

| Theme | Activation | Purpose |
| :--- | :--- | :--- |
| **Daylight (Default)** | `:root` (no `data-theme`) | Official `umamusume.jp` Cobalt (`#3157ed`) & Stage Orange (`#ff7b16`) aesthetic on airy tonal canvas (`#f3f5fb`). |
| **Night (Campaign Base)** | `body.ui-theme-dark[data-theme="night"]` | Shared dark base used **exclusively** for temporary special campaigns (e.g. `data-variant="daring-tact"` / `daring-tact-crowned`). Never exposed as a permanent normal-day toggle. |

### Theme Rules
- **Zero hardcoded `#fff` / `#000` / hex backgrounds in components**: Always reference semantic tokens (`--surface-canvas`, `--surface-panel`, `--surface-subtle`, `--surface-hover`, `--surface-glass`, `--ink-1`, `--ink-2`, `--ink-3`, `--accent-primary`, `--accent-secondary`).
- **Every overlay, sticky bar, drawer, modal, and skeleton** (`.context-navigation`, `.audio-dock`, `.audio-panel`, `.ui-select-menu`, `.uma-image-viewer`, `.route-placeholder`) MUST adapt cleanly under `body.ui-theme-dark`.

---

## 2. Typography Contract (Strict 3-Tier Scale)

All UI and content across the site uses **one unified sans-serif stack** (`--font-sans`) and **at most 3 font-size tiers** (hard maximum 4 only for special campaign display art):

| Tier | Token | Size | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1 (Display)** | `--text-display` | `clamp(1.375rem, 2vw, 1.625rem)` (22–26px) | `700` | Page `h1` & entity masthead titles only. |
| **Tier 2 (Primary)** | `--text-body` | `0.9375rem` (15px) | `400` prose / `600` titles & tabs | Body paragraphs, card titles, tabs, buttons, form controls, primary values. |
| **Tier 3 (Meta)** | `--text-meta` | `0.8125rem` (13px) | `400` secondary / `500–600` labels & pills | Table headers, metadata labels (`dt`), timestamps, badges, secondary lines. |

### Typography Rules
- **Never invent ad-hoc font sizes** to create hierarchy — use weight (`400` / `500` / `600`), ink contrast (`--ink-1` / `--ink-2` / `--ink-3`), and spacing instead.
- **Avoid bolding body content**: Keep prose and descriptions at weight `400`.
- **Upright UI**: All labels, badges, breadcrumbs, tabs, and card captions use `font-style: normal` (no random italic clashes).
- **Tabular Numbers**: All counters, dates, durations, track numbers, and stats MUST apply `font-variant-numeric: tabular-nums` for jitter-free layout.
- **Non-selectable UI & Decorative Text**: Buttons, nav items, tabs, badges, and decorative hero/magazine typography MUST set `user-select: none`. Real data (names, titles, lyrics, emails, descriptions) stays selectable.

---

## 3. Continuous Concentric Radii & Spacing

### Concentric Border Radius Scale
Inner elements MUST nest concentrically inside outer containers (`innerRadius ≈ outerRadius - padding`):

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--radius-panel` | `20px` | Hero mastheads, major floating containers, drawers. |
| `--radius-card` | `14px` | Cards, metadata tiles, legal blocks, disclosures, dropdown panels. |
| `--radius-control` | `10px` | Inputs, selects, primary buttons, menu options, tab hover pills. |
| `--radius-badge` | `6px` | Compact category tags, section numbers. |
| `--radius-pill` | `999px` | Filter chips, email pills, status badges, circular action buttons. |

### Spacing Scale & Nesting Limit
- Base 4px grid: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-7: 32px`.
- **Maximum card nesting depth: 3 layers** (Canvas → Panel → Tile). Prefer tonal elevation (`--surface-panel` / `--surface-subtle`) and whitespace over 1px divider lines.
- **Geometry constraint**: Only the top `.sub-header` navigation bar uses slanted `umamusume.jp` parallelograms. Dropdown menus and all page content use upright rounded geometry.

---

## 4. Motion & Spring Physics

All transitions are GPU-composited (`transform`, `opacity`) and respect `@media (prefers-reduced-motion: reduce)`:

| Physics Profile | Spring Equivalent | CSS Token / Easing | Duration | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Drag & Snap** | `stiffness: 1200, damping: 80` (zero rebound) | `--spring-drag: cubic-bezier(0.22, 1, 0.36, 1)` | `200ms` | Queue drag-reorder snap, sibling displacement, drawer settle. |
| **Pop & Micro-Rebound** | `stiffness: 380, damping: 18` (subtle rebound) | `--spring-pop: cubic-bezier(0.34, 1.56, 0.64, 1)` | `340ms` | Checkbox check, favorite/crown pop, tab ink-bar glide, card hover lift. |
| **Editorial Glide** | Smooth deceleration | `--ease-uma: cubic-bezier(0.19, 1, 0.22, 1)` | `260–360ms` | Route entrance, tab panel reveal, dropdown open/close, sticky bar reveal. |

### Interaction & Performance Rules
- **Zero abrupt visibility changes**: Every show/hide element (sticky bars, dropdowns, drawers, feedback banners) MUST transition smoothly via opacity + transform.
- **Transient feedback**: Copy-success checkmarks and transient status toasts auto-dismiss after **`2500ms`**.
- **UI thread protection**: Never run heavy synchronous loops on the main thread during scroll/drag/pointer events; batch DOM reads/writes inside `requestAnimationFrame` and use `{ passive: true }` listeners.

---

## 5. Copy & UI Hygiene Rules

- **Zero middle dots (`·`)** as UI separators anywhere in templates or rendered metadata.
- **Zero unnecessary `↗` arrows** on UI links or buttons.
- **Zero borders on character/voice/horse chips** (`.performer-chip`).
- **No small helper footnotes or explanatory UI subtitles**: Do not add subtitles explaining how a page or control works. Button labels state the direct action outcome. When contextual explanation is genuinely required, place it behind an info icon (`i`) click popover.
- **No trailing periods (`。`)** on single-line functional UI copy, labels, placeholders, or short taglines.

---

## 6. Module Ownership & Line-Count Budget

- Every frontend `.js` and `.css` file under `uma_tools/frontend/` MUST stay strictly **`< 1000` lines** with clear single-purpose naming.
- Core stylesheet cascade order in `赛马娘LIVE相关.html`:
  1. `tokens.css` (design tokens)
  2. Base & component sheets
  3. `motion-editorial.css` (global typography, elevation, kinetic motion)
  4. `media-overlay.css` (disclosures, tables, audio dock, lightbox)
  5. `responsive-mobile.css` (3-tier phone adaptation: `≤767px`, `≤430px`, `≤375px`)
  6. `theme-night.css` (shared dark campaign base & variants)
