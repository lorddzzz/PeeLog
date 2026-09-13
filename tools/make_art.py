#!/usr/bin/env python3
"""Generate PeeLog's decorative art JPEGs. macOS-only: shells out to the
built-in `sips` (Scriptable Image Processing System), so no Pillow/ImageMagick
and no CDN. Not portable to Linux CI — run this on a Mac and commit the output.

Source PNGs are 1536x1024 design-package originals (1.3-1.5 MB each), far too
heavy for a 140px header vignette or an offline-precached shell. Downsampling
to 560px wide and re-encoding as JPEG at ~80 quality gets each file to
roughly 10-30 KB with no visible banding on the dark #10151E ground.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "ux" / "assets" / "illustrations"
OUT = ROOT / "assets" / "art"

TARGETS = [
    ("bedtime-moon.png", "bedtime-moon.jpg"),
    ("bedside-notebook.png", "bedside-notebook.jpg"),
]

WIDTH = 560
QUALITY = 80


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src_name, out_name in TARGETS:
        src = SRC / src_name
        dst = OUT / out_name
        subprocess.run(
            [
                "sips",
                "-s", "format", "jpeg",
                "-s", "formatOptions", str(QUALITY),
                "--resampleWidth", str(WIDTH),
                str(src),
                "--out", str(dst),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        kb = dst.stat().st_size / 1024
        print(f"  {out_name:24} {kb:6.1f} KB")


if __name__ == "__main__":
    main()
