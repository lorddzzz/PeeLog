# Quiet company — asset inventory

Design exports for the approved visual direction. These files are in the design
package; they have not replaced the live app's icons or manifest.

[Download the complete asset bundle](peelog-assets.zip). The archive contains the
asset files, design tokens, usage inventory, editable export source, and the
original moon prompt as `MOON-PROMPT.md`.

## Identity

| File in assets/brand/ | Use |
| --- | --- |
| app-icon-master.svg | Editable opaque vector master, 1024 × 1024 |
| mark.svg | Transparent vector crescent and cradle arc |
| wordmark.svg | Mark + lowercase peelog; text remains editable using system sans-serif |
| app-icon-1024.png | 1024 px raster master |
| icon-512.png | 512 px standard app icon |
| icon-maskable-512.png | 512 px maskable icon, opaque background; mark inside safe central region |
| icon-192.png | 192 px app icon |
| apple-touch-icon-180.png | 180 px iOS home-screen asset |
| favicon-32.png | 32 px browser icon |

The simplified crescent over a blue cradle-like arc is the app identity. Do not
use the detailed raster illustration as a tiny icon. The opaque background is
midnight `#10151E`; no baked outer rounding, since platforms apply their own mask.
Keep at least a quarter-mark width of clear space around the standalone mark.
The wordmark is for dark backgrounds and retains editable text rather than
pretending to be a font-independent outline. Body fonts are system-provided.

## Interface icons

40 original vector icons are supplied individually in `assets/icons/`, as a
single SVG symbol collection in `assets/icons.svg`, and listed in
`assets/icon-names.json`.

- Events: toilet, carry, water, wake, drop.
- Navigation: moon, history, more, patterns, routine, back, chevron-right.
- Editing: check, undo, plus, minus, close, edit, delete, clock, bed, sun, note.
- Utilities: backup, restore, share, print, shield, info, alert, phone, offline,
  appearance, reminder, filter, empty.
- Neutral record states: review, dry, missing, complete.

Geometry: 24 × 24 viewBox, 1.5 px rounded strokes, currentColor; standalone files
include a muted blue default colour. Use 20–28 px in the UI. Touch targets belong
to the control, not to the drawing. Primary event icons always accompany text.

Meaning is stable: dry uses a ring, wet uses a droplet, review due uses an exclamation
ring, and missing uses a dashed ring. Do not rely on green/red. Saved checkmarks
describe successful app writes, not a child's dry outcome.

## Illustrations

| File in assets/illustrations/ | Placement | Rules |
| --- | --- | --- |
| bedtime-moon.png | Tonight header; appearance preview | Decorative, static, about 100–140 px visible vignette; reduce before crowding controls |
| bedside-notebook.png | Welcome, empty history, backup introduction | Decorative, static; no illustration required on an error or filled data screen |

Both originals are 1536 × 1024 PNGs on a midnight ground. They intentionally
contain generous negative space. Use a bounded image area and keep labels out
of the illustrated area. An empty alt attribute is appropriate when accompanying
text already explains the screen. The art toggle hides them without collapsing
the Tonight control layout. Preserve the PNG originals; generate any future
optimised derivatives separately during implementation.

Both were created using the built-in image-generation tool on 13 September 2026.
The notebook used the moon as a visual-style reference. No CLI/API fallback was used.
The moon's original prompt is in [the first demo's asset notes](../demo/ASSETS.md).

### Complete notebook prompt

Use case: illustration-story. Create a new decorative illustration for the PeeLog
app. The supplied image is a STYLE REFERENCE ONLY: match its sophisticated soft
gouache, paper grain, midnight background and restrained blue/oatmeal palette.
New subject: a small closed slate-blue bedside notebook lying gently at a slight
angle, with one warm oatmeal crescent-moon mark on its cover and a soft fabric
bookmark tucked between the pages. No text or lettering. One small four-point star
above it. No other props. This illustration is for the empty history and welcome
screens of an adult-facing nighttime log; warm and comforting but not babyish.
Landscape 3:2 composition with a compact centred vignette and ample space around
it. Solid midnight #10151e background reaching every edge, subtle texture only on
objects. Muted low luminance, no bright white, no glow, no UI, no watermark. Preserve
the calm handmade feeling of the reference without reusing its pillow or quilt.

## Design tokens

`tokens.json` specifies the palette, type, spacing, radii, minimum touch target,
icon strokes, and motion intent. Its border token is deliberately more visible
than the first demo's quiet card outlines, to support identifying form controls.
Wet is a neutral recorded fact; error uses explicit copy and its own surface.

The editable vector exports are authored design assets. The deterministic export
source is `source/build_assets.py`; it is design tooling, not app functionality.
No external icon library, paid font, stock photo, or remote asset is required.
