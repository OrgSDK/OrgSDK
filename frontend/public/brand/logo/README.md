# OrgSDK — Logo & Brand Assets

The **Orbit-O** mark and lockups for OrgSDK (multi-agent sandbox orchestration).
All assets are hand-authored SVG — infinitely scalable, editable, no raster.

## Brand Palette

| Token | Hex | Use |
|-------|-----|-----|
| Indigo (primary) | `#4f46e5` | Mark ring, accents, primary surfaces (matches dashboard) |
| Indigo deep | `#4338ca` | Wordmark "SDK" on light |
| Violet | `#8b5cf6` | Mark node (the orbiting agent) |
| Ink | `#0f172a` | Wordmark "Org" / headings on light |
| Light fg | `#e2e8f0` | Wordmark on dark |

Font: **Inter** (700 for wordmark, tight tracking).

## Primary Mark — Orbit-O

A bold indigo ring (the "O" / org hub) with a violet agent node orbiting its
upper-right edge.

**Why:** ownable (a ringed initial is unmistakably ours), scales from hero to
favicon (just two elements — ring + node — survive 16px), and carries the
product concept (an agent orbiting the org hub = orchestration) without a
cliché robot. The violet node is the signature that separates it from a plain
letter "O".

**Construction:** the ring is a `<circle>` with `fill="none"` + a thick
`stroke`; the node is a filled `<circle>`. Tune the ring with `r` (size),
`stroke-width` (thickness), `stroke` (color). One mark works at every size —
no separate outline/solid variant.

## Canonical files

| File | Use |
|------|-----|
| `primary.svg` | The mark, transparent (any surface, any size). |
| `lockup-integrated.svg` | **Primary lockup** — the mark forms the "O" in "OrgSDK". |
| `lockup-light.svg` | Mark + full "OrgSDK" wordmark (mark separate from text), light surfaces. |
| `lockup-dark.svg` | Lockup for dark surfaces (secondary / on-demand). |
| `favicon.svg` | The mark, transparent (browser tab). |
| `app-icon.svg` | Mark on an indigo rounded tile (app stores, GitHub / social avatar). |
| `og-image.svg` | 1200×630 social / OG card (lockup + tagline + URL on white). |
| `preview.html` | View the canonical set on light + dark. |

`primary-solid.svg` is kept as an alias of `primary.svg` for any existing
references; prefer `primary.svg`.

## Raster export

`render.ts` regenerates the raster the landing page (and other surfaces) consume
straight from the canonical SVGs above, using `@resvg/resvg-js` with Inter loaded
explicitly from `fonts/` (so the render is reproducible without system Inter).
The favicon ICO is packed from 16/32/48 PNGs via ImageMagick `convert`.

```bash
bun brand/logo/render.ts        # writes packages/landing/public/{192,512,apple-touch-icon}.png, favicon.ico, og-image.png
```

| Output | Source | Notes |
|---|---|---|
| `192.png`, `512.png`, `apple-touch-icon.png` | `app-icon.svg` | Tiled mark — PWA + iOS home screens. |
| `favicon.ico` (16/32/48) | `primary.svg` | Bare transparent mark, browser tab. Multi-size. |
| `og-image.png` (1200×630) | `og-image.svg` | Social / OG card; lockup + tagline + URL on white. |

The canonical raster in `raster/` (`banner-1500x500.png`, `profile-512.png`,
`profile-1024.png`, `square-1080.png`) serves other surfaces (GitHub avatar,
sponsor banners, app-store listings) and is **not** overwritten by `render.ts` —
refresh those separately when the mark changes.

`fonts/Inter-Regular.ttf` and `fonts/Inter-Bold.ttf` are the OFL-licensed Inter
weights used by every wordmark-bearing SVG; keep them alongside the sources so
the render is self-contained.

## Direction (light-first, indigo)

OrgSDK's surfaces are **light** with an **indigo `#4f46e5`** accent — matching
the dashboard, which is the reference surface. The earlier teal palette and the
near-black `#06080f` terminal background are **deprecated** and are being
removed from the product (landing theme). `lockup-dark.svg` is the only dark
asset, kept for the rare genuinely-dark surface.

## Usage notes

- Marks are transparent and adapt to any background.
- Wordmarks use **Inter 700**. For print / favicon / app-store, convert text to
  paths and export raster (PNG/ICO) — run `bun brand/logo/render.ts` (see
  "Raster export" above).
- Minimum clear space = the mark's height on all sides.
- For single-color contexts (print, embroidery, watermark), set the ring's
  `stroke` and the node's `fill` to the same single value.
