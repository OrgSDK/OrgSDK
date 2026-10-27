# OrgSDK — Brand Tokens (canonical)

Source of truth for the OrgSDK visual system. Engineering reference for putting
every product surface (landing, dashboard) on one **light + indigo** system.

## Context

Light-first, indigo accent. The **app** (`packages/app/src/styles/globals.css`)
is the reference surface — its token layer is canonical. The **landing** is being
migrated off its deprecated dark-terminal theme
(`packages/landing/src/themes/theme.css`) onto this same token set.

## Color tokens (semantic — CSS custom properties / Tailwind `@theme`)

| Token | Value | Use |
|---|---|---|
| `--color-background` | `#ffffff` | App background |
| `--color-foreground` | `#0f172a` | Default text (ink) |
| `--color-card` | `#ffffff` | Cards |
| `--color-card-foreground` | `#0f172a` | Card text |
| `--color-popover` | `#ffffff` | Popovers / menus |
| `--color-popover-foreground` | `#0f172a` | Popover text |
| `--color-primary` | `#4f46e5` | Primary actions + brand accents (indigo) |
| `--color-primary-foreground` | `#ffffff` | Text on primary |
| `--color-secondary` | `#f1f5f9` | Secondary surfaces |
| `--color-secondary-foreground` | `#0f172a` | |
| `--color-muted` | `#f1f5f9` | Muted surfaces |
| `--color-muted-foreground` | `#64748b` | Muted text |
| `--color-accent` | `#eef2ff` | Accent surface (indigo-100) |
| `--color-accent-foreground` | `#4338ca` | Accent text (indigo-deep) |
| `--color-destructive` | `#dc2626` | Destructive actions |
| `--color-destructive-foreground` | `#ffffff` | |
| `--color-border` | `#e2e8f0` | Borders |
| `--color-input` | `#e2e8f0` | Inputs |
| `--color-ring` | `#4f46e5` | Focus rings |
| `--color-sidebar` | `#f8fafc` | Sidebar bg |
| `--color-sidebar-foreground` | `#0f172a` | |
| `--color-sidebar-border` | `#e2e8f0` | |

### Brand (mark) palette

| Token | Value | Use |
|---|---|---|
| Indigo | `#4f46e5` | Mark ring, primary |
| Indigo deep | `#4338ca` | Wordmark "SDK" |
| Violet | `#8b5cf6` | Mark node (orbiting agent). Optional secondary accent for marketing/illustration — **not** a required UI token. |
| Ink | `#0f172a` | Wordmark "Org", headings |

## Type
- Font: **Inter** (700 for wordmark/headings, tight tracking).
- Type scale: Tailwind defaults.

## Radius

| Token | Value |
|---|---|
| `--radius-sm` | `0.25rem` |
| `--radius-md` | `0.375rem` |
| `--radius-lg` | `0.5rem` |
| `--radius-xl` | `0.75rem` |

## Deprecated (remove during retheme)
- Old palette: teal `#14b8a6`, teal-deep `#0d9488`, emerald `#10b981`.
- Dark surfaces: `#06080f`, `#0a0c14`.
- Landing `theme.css` dark `:root`; the misnamed `--accent-indigo*` vars that
  currently hold **teal** values; dark glow utilities (`--hero-glow`,
  `--cta-glow`, `.glow-primary*`).

## Landing retheme target
Replace `packages/landing/src/themes/theme.css` `:root` with the semantic tokens
above (light values). The landing must render on `#ffffff` with indigo accents,
matching the dashboard. Where components hardcode dark/teal (gradients, glows,
explicit hex), remediate to the token values. Design-judgment calls (a section
that doesn't read well on light, the Three.js hero) → flag, don't guess.
