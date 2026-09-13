#!/usr/bin/env python3
"""Regenerate the inline icon sprite in index.html from assets/icons.svg.

Safari has never supported cross-document <use href="file.svg#id"> — WebKit
only resolves same-document fragment references. So the sprite that ships
in the design package as an external assets/icons.svg is duplicated here as
a hidden inline <svg> of <symbol>s, which Safari can reference locally with
<use href="#i-name">. assets/icons.svg stays as the single source of truth;
this script keeps index.html's copy in sync with it.

Pure stdlib, idempotent: run it again any time icons.svg changes.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS_SVG = ROOT / "assets" / "icons.svg"
INDEX_HTML = ROOT / "index.html"

START = "<!-- sprite:start -->"
END = "<!-- sprite:end -->"

SYMBOL_RE = re.compile(r"<symbol\b.*?</symbol>", re.DOTALL)


def main():
    src = ICONS_SVG.read_text(encoding="utf-8")
    symbols = SYMBOL_RE.findall(src)
    if not symbols:
        raise SystemExit(f"no <symbol> elements found in {ICONS_SVG}")

    # Symbol ids get an `i-` prefix: a bare id like "undo" or "history" would
    # otherwise shadow same-named element ids for getElementById.
    symbols = [re.sub(r'<symbol\b([^>]*?)\bid="', r'<symbol\1id="i-', s, count=1) for s in symbols]

    sprite = (
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">'
        + "".join(symbols)
        + "</svg>"
    )
    block = f"{START}\n{sprite}\n{END}"

    html = INDEX_HTML.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)
    if not pattern.search(html):
        raise SystemExit(f"markers {START} / {END} not found in {INDEX_HTML}")

    new_html = pattern.sub(block, html, count=1)
    INDEX_HTML.write_text(new_html, encoding="utf-8")
    print(f"  wrote {len(symbols)} symbols ({len(sprite)} bytes) into {INDEX_HTML.name}")


if __name__ == "__main__":
    main()
