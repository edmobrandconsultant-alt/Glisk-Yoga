#!/usr/bin/env python3
"""
Generate Glisk brand images that don't need photography:
the social-preview (Open Graph) cards, and correctly-sized
placeholders for the photo slots.

Run from the repo root:  python3 scripts/make-brand-images.py

Requires Pillow:  pip install pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os, math

OUT = "assets/img"
os.makedirs(OUT, exist_ok=True)

# --- brand tokens, matching assets/css/style.css -------------------------
INK        = (35, 31, 28)
INK_SOFT   = (74, 66, 60)
MUTED      = (125, 114, 104)
PAPER      = (250, 246, 240)
PAPER_2    = (242, 235, 225)
GLEAM      = (192, 138, 62)
GLEAM_SOFT = (232, 211, 176)

SERIF = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
SANS  = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def backdrop(w, h):
    """Cream background with a soft warm 'gleam' in the upper right."""
    img = Image.new("RGB", (w, h), PAPER)
    px = img.load()
    cx, cy = w * 0.78, h * 0.10
    rad = max(w, h) * 0.85
    for y in range(h):
        # vertical wash from PAPER to PAPER_2
        t = y / h
        base = tuple(int(PAPER[i] + (PAPER_2[i] - PAPER[i]) * t) for i in range(3))
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / rad
            g = max(0.0, 1.0 - d) ** 2 * 0.55
            px[x, y] = tuple(int(base[i] + (GLEAM_SOFT[i] - base[i]) * g) for i in range(3))
    return img


def tracked(draw, xy, text, fnt, fill, tracking):
    """Draw text with manual letterspacing. Returns total width."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x - xy[0] - tracking


def tracked_width(draw, text, fnt, tracking):
    return sum(draw.textlength(c, font=fnt) for c in text) + tracking * (len(text) - 1)


def og_card(filename, headline, sub):
    """1200x630 Open Graph card."""
    W, H = 1200, 630
    img = backdrop(W, H)
    d = ImageDraw.Draw(img)

    # wordmark, centred, wide tracking — GLIS in ink, K in gleam
    f_mark = font(SERIF, 92)
    tr = 18
    word = "GLISK"
    total = tracked_width(d, word, f_mark, tr)
    x = (W - total) / 2
    y = 176
    for i, ch in enumerate(word):
        d.text((x, y), ch, font=f_mark, fill=GLEAM if i == 4 else INK)
        x += d.textlength(ch, font=f_mark) + tr

    # rule
    d.line([(W / 2 - 90, 316), (W / 2 + 90, 316)], fill=GLEAM, width=2)

    # headline
    f_head = font(SERIF, 44)
    w = d.textlength(headline, font=f_head)
    d.text(((W - w) / 2, 350), headline, font=f_head, fill=INK_SOFT)

    # subline, tracked small caps
    f_sub = font(SANS, 21)
    tr2 = 5
    total = tracked_width(d, sub, f_sub, tr2)
    tracked(d, ((W - total) / 2, 432), sub, f_sub, MUTED, tr2)

    img.save(os.path.join(OUT, filename), quality=90, optimize=True)
    print("wrote", filename, f"{W}x{H}")


def placeholder(filename, w, h, label):
    """A clearly-marked placeholder at the exact dimensions needed."""
    img = backdrop(w, h)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=GLEAM_SOFT, width=3)

    f = font(SANS, max(14, int(w / 34)))
    lines = [label, "", f"{w} x {h}", "replace this file — keep the name"]
    total_h = len(lines) * (f.size + 10)
    y = (h - total_h) / 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((w - tw) / 2, y), ln, font=f, fill=MUTED)
        y += f.size + 10

    img.save(os.path.join(OUT, filename), quality=85, optimize=True)
    print("wrote", filename, f"{w}x{h}")


if __name__ == "__main__":
    og_card("og.jpg",
            "Deep tissue & relaxation massage",
            "BRISTOL & BATH")
    og_card("og-voucher.jpg",
            "An hour of proper rest.",
            "GIFT VOUCHERS · BRISTOL & BATH")

    placeholder("fleur-portrait.jpg", 800, 1000, "PHOTO OF FLEUR")
    placeholder("treatment-room.jpg", 1600, 1000, "TREATMENT ROOM")
    placeholder("home-visit.jpg", 1600, 1000, "COUCH SET UP AT HOME")
