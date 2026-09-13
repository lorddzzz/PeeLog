# PeeLog

A night-wetting tracker for one child, built for the person logging at 3am.
Design and scope: [docs/DESIGN.md](docs/DESIGN.md).
Build plan: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

Visual design: [UX handoff](docs/UX-HANDOFF.md),
[screen library](docs/ux/index.html), and [assets](docs/ux/ASSETS.md).
These are design studies for the implementation phase. When serving locally,
open `/docs/ux/` to browse all screens.

**Status: M5 built, awaiting on-phone verification.** Tonight logging with
optional detail and undo, evening / morning / following-day cards, history
with editing and backfill, patterns with hand-rolled charts, routines, backup
and restore, CSV / JSON / printable summary, and a More screen that holds the
install and self-test checks. What has not been verified on the actual iPhone
is listed in [docs/IMPLEMENTATION.md §7](docs/IMPLEMENTATION.md).

## Privacy

The code is public. The data never is. Everything logged stays in `localStorage`
on the phone — there is no account, no server and no analytics. Nothing is ever
uploaded, and exports are gitignored.

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Service workers need HTTPS or `localhost`,
so opening `index.html` as a `file://` URL will not exercise the offline path.

## Deploy

Push to `main`. GitHub Pages serves the repo root; there is no build step.

## Install on the phone

Safari → Share → **Add to Home Screen**, then launch from the icon. Open the
**More → Install & offline** screen, confirm the rows, then turn on Airplane Mode and relaunch from
the icon. If the app opens with no network, the foundation works.

## Icons & art

Icons live as individual SVGs and a combined sprite in `assets/icons/` and
`assets/icons.svg`. Safari has never supported cross-document `<use
href="file.svg#id">`, so `index.html` also carries the sprite inlined as a
hidden `<svg>` between `<!-- sprite:start -->` / `<!-- sprite:end -->`
markers; icons are used in markup as `<svg class="ico"><use
href="#name"/></svg>`. Regenerate that block after editing `assets/icons.svg`:

```bash
python3 tools/make_sprite.py
```

The illustration originals in `docs/ux/assets/illustrations/` are 1.3–1.5 MB
PNGs — too heavy to precache. `tools/make_art.py` (macOS only, shells out to
`sips`) downsamples them to 560px-wide JPEGs in `assets/art/`:

```bash
python3 tools/make_art.py
```

Bump `CACHE` in `sw.js` whenever a precached file changes, or phones will keep
serving the old shell.
