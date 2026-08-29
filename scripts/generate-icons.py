#!/usr/bin/env python3
"""Generate BubblinCrude home-screen icons — dark panel + teal/amber oil drop."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BG = (10, 12, 16)
TEAL = (46, 196, 182)
AMBER = (232, 168, 56)
PANEL = (20, 24, 32)


def build_icon(size: int, maskable: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (*BG, 255))
    draw = ImageDraw.Draw(canvas)

    pad = int(size * (0.18 if maskable else 0.1))
    # subtle panel
    draw.rounded_rectangle(
        (pad, pad, size - pad, size - pad),
        radius=int(size * 0.12),
        fill=(*PANEL, 255),
        outline=(255, 255, 255, 28),
        width=max(1, size // 128),
    )

    cx, cy = size // 2, int(size * 0.48)
    drop_h = int(size * 0.42)
    drop_w = int(size * 0.28)

    # oil drop path (teardrop)
    pts = []
    for i in range(64):
        t = i / 63
        ang = -math.pi / 2 + t * 2 * math.pi
        # stretch bottom
        rx = drop_w * (0.55 + 0.45 * abs(math.sin(ang)))
        ry = drop_h * 0.5
        # tip at top
        tip_pull = max(0, -math.sin(ang)) ** 1.6
        x = cx + rx * math.cos(ang) * (1 - 0.15 * tip_pull)
        y = cy + ry * math.sin(ang) - tip_pull * drop_h * 0.35
        pts.append((x, y))

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (cx - drop_w, cy - drop_h * 0.2, cx + drop_w, cy + drop_h * 0.7),
        fill=(*TEAL, 40),
    )
    canvas = Image.alpha_composite(
        canvas, glow.filter(ImageFilter.GaussianBlur(radius=size // 18))
    )
    draw = ImageDraw.Draw(canvas)

    # gradient-ish drop: teal left, amber right via two halves
    draw.polygon(pts, fill=(*TEAL, 255))
    # amber highlight crescent
    hx = cx + int(drop_w * 0.15)
    draw.ellipse(
        (
            hx - drop_w * 0.35,
            cy - drop_h * 0.05,
            hx + drop_w * 0.45,
            cy + drop_h * 0.45,
        ),
        fill=(*AMBER, 210),
    )
    # specular
    draw.ellipse(
        (
            cx - drop_w * 0.35,
            cy - drop_h * 0.25,
            cx - drop_w * 0.05,
            cy + drop_h * 0.05,
        ),
        fill=(255, 255, 255, 70),
    )

    # small map-dot cluster
    for dx, dy, col in (
        (-0.28, 0.32, TEAL),
        (-0.18, 0.38, AMBER),
        (-0.08, 0.34, TEAL),
    ):
        r = max(2, size // 48)
        x = int(size * (0.5 + dx))
        y = int(size * (0.5 + dy))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(*col, 255))

    return canvas.convert("RGBA")


def save_icons() -> None:
    icon_512 = build_icon(512).convert("RGB")
    icon_512.save(ROOT / "icon-512.png", "PNG")
    icon_512.resize((192, 192), Image.Resampling.LANCZOS).save(ROOT / "icon-192.png", "PNG")
    icon_512.resize((180, 180), Image.Resampling.LANCZOS).save(
        ROOT / "apple-touch-icon.png", "PNG"
    )
    build_icon(512, maskable=True).convert("RGB").save(ROOT / "icon-maskable-512.png", "PNG")
    print(f"Wrote icons in {ROOT}")


if __name__ == "__main__":
    save_icons()
