#!/usr/bin/env python3
"""Generate PeeLog app icons. Pure stdlib - no Pillow, no ImageMagick, no CDN.

Draws a droplet as the union of a circle and the triangle formed by the two
tangent lines from an apex point above it. 3x3 supersampled for clean edges.
Output is opaque RGB: iOS composites apple-touch-icon over black otherwise.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

BG_TOP    = (0x16, 0x1C, 0x2A)
BG_BOTTOM = (0x07, 0x09, 0x0D)
DROP_TOP    = (0x8FC0, 0xF000, 0x0000)  # placeholder, replaced below
DROP_TOP    = (0x8F, 0xC0, 0xF5)
DROP_BOTTOM = (0x3D, 0x7F, 0xC4)

# Droplet geometry in shape space (canvas spans -1..1 on both axes).
CY, R, APEX_Y = 0.30, 0.40, -0.75


def _tangent_points():
    d = CY - APEX_Y
    cos_a = R / d
    alpha = math.acos(cos_a)
    # Rotate the apex-ward unit vector (0,-1) by +/- alpha.
    tx = math.sin(alpha) * R
    ty = CY - math.cos(alpha) * R
    return (tx, ty), (-tx, ty)


T_POS, T_NEG = _tangent_points()


def _in_triangle(x, y, a, b, c):
    def side(p, q):
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    s1, s2, s3 = side(a, b), side(b, c), side(c, a)
    return not ((s1 < 0 or s2 < 0 or s3 < 0) and (s1 > 0 or s2 > 0 or s3 > 0))


def _in_droplet(x, y):
    if (x * x + (y - CY) ** 2) <= R * R:
        return True
    return _in_triangle(x, y, (0.0, APEX_Y), T_POS, T_NEG)


def _lerp(c0, c1, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))


def render(size, drop_scale):
    """drop_scale shrinks the droplet; use a smaller value for maskable icons
    so the shape survives the platform's aggressive circular crop."""
    ss = 3                      # supersampling factor per axis
    samples = ss * ss
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    # Map pixel centre to -1..1, y pointing down.
                    nx = ((px + (sx + 0.5) / ss) / size) * 2 - 1
                    ny = ((py + (sy + 0.5) / ss) / size) * 2 - 1
                    bg = _lerp(BG_TOP, BG_BOTTOM, (ny + 1) / 2)
                    if drop_scale > 0 and _in_droplet(nx / drop_scale, ny / drop_scale):
                        shade = min(max((ny / drop_scale - APEX_Y) / (CY + R - APEX_Y), 0.0), 1.0)
                        col = _lerp(DROP_TOP, DROP_BOTTOM, shade)
                    else:
                        col = bg
                    for i in range(3):
                        acc[i] += col[i]
            row += bytes(v // samples for v in acc)
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    return len(png)


TARGETS = [
    ("icon-192.png", 192, 0.78),
    ("icon-512.png", 512, 0.78),
    ("icon-maskable-512.png", 512, 0.58),
    ("apple-touch-icon-180.png", 180, 0.78),
    ("favicon-32.png", 32, 0.86),
]

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, size, scale in TARGETS:
        n = write_png(OUT / name, size, render(size, scale))
        print(f"  {name:28} {size:>4}px  {n/1024:6.1f} KB")
