#!/usr/bin/env python3
"""Generate a 1024x1024 app icon PNG (stdlib only)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, rgb_rows: list[bytes]) -> None:
    raw = b"".join(b"\x00" + row for row in rgb_rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    size = 1024
    bg = (13, 13, 13)
    accent = (94, 150, 203)
    cx = cy = size / 2
    r = 280
    rows: list[bytes] = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx = x - cx
            dy = y - cy
            dist = math.sqrt(dx * dx + dy * dy)
            if dist <= r:
                t = dist / r
                # slightly brighter in the center
                mix = 1 - t * 0.25
                row += bytes(int(c * mix) for c in accent)
            elif dist <= r + 18:
                row += bytes(accent)
            else:
                row += bytes(bg)
        rows.append(bytes(row))
    out = Path(__file__).resolve().parents[1] / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon.png"
    write_png(out, size, size, rows)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
