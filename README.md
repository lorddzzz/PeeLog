# PeeLog

A night-wetting tracker for one child, built for the person logging at 3am.
Design and scope: [docs/DESIGN.md](docs/DESIGN.md).

Visual design: [UX handoff](docs/UX-HANDOFF.md),
[screen library](docs/ux/index.html), and [assets](docs/ux/ASSETS.md).
These are design studies for the separate implementation phase. When serving
locally, open `/docs/ux/` to browse all screens.

**Status: M0** — app shell, PWA install, offline caching and an install-check
screen. Taps on the Tonight screen are not recorded yet; that is M1.

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
**Check** tab, confirm the rows, then turn on Airplane Mode and relaunch from
the icon. If the app opens with no network, the foundation works.

## Icons

Regenerate after editing `tools/make_icons.py` (pure stdlib, no dependencies):

```bash
python3 tools/make_icons.py
```

Bump `CACHE` in `sw.js` whenever a precached file changes, or phones will keep
serving the old shell.
