#!/usr/bin/env python3
"""
Placeholder posters and clips for the three Instagram posts on the home page.

These exist so the layout is real and nothing is broken before Fleur's own
photos and videos land. Replace them file for file, keeping the names — the
HTML already points at them.

Run from the repo root:  python3 scripts/make-post-placeholders.py
Requires Pillow.  Video generation needs ffmpeg; it is skipped if absent.
"""
from PIL import Image, ImageDraw, ImageFont
import os, shutil, subprocess, math

OUT_IMG, OUT_VID = "assets/img", "assets/video"
os.makedirs(OUT_IMG, exist_ok=True)
os.makedirs(OUT_VID, exist_ok=True)

# brand tokens, matching assets/css/style.css
INK, PAPER, PAPER2 = (35, 31, 28), (250, 246, 240), (242, 235, 225)
GLEAM, GLEAM_SOFT, LINE = (192, 138, 62), (232, 211, 176), (227, 217, 204)

W, H = 720, 1280          # 9:16, the shape Instagram reels are

def font(size, bold=False):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif%s.ttf" % ("-Bold" if bold else ""),
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else "")):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def poster(name, label):
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # a soft vertical wash so it reads as a designed placeholder, not a bug
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)],
               fill=tuple(int(PAPER[i] + (PAPER2[i] - PAPER[i]) * t) for i in range(3)))

    # the sun motif from the logo
    cx, cy, r = W // 2, int(H * 0.42), 132
    d.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=GLEAM_SOFT)
    for angle in (-90, -65, -115, -40, -140):
        a = math.radians(angle)
        x1, y1 = cx + math.cos(a) * (r + 22), cy + math.sin(a) * (r + 22)
        x2, y2 = cx + math.cos(a) * (r + 74), cy + math.sin(a) * (r + 74)
        d.line([(x1, y1), (x2, y2)], fill=GLEAM, width=11)

    d.line([(cx - r, cy), (cx + r, cy)], fill=GLEAM, width=4)

    f1, f2 = font(46, True), font(27)
    for text, f, dy, col in ((label, f1, 90, INK), ("photograph to come", f2, 152, (125, 114, 104))):
        w = d.textbbox((0, 0), text, font=f)[2]
        d.text(((W - w) / 2, cy + dy), text, font=f, fill=col)

    d.rectangle([12, 12, W - 12, H - 12], outline=LINE, width=3)
    path = os.path.join(OUT_IMG, name)
    img.save(path, "JPEG", quality=82, optimize=True)
    print(f"  {path}  {os.path.getsize(path) // 1024} KB")
    return path

def clip(poster_path, name):
    ff = shutil.which("ffmpeg") or "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux"
    if not os.path.exists(ff) and not shutil.which("ffmpeg"):
        print("  (ffmpeg not found — skipping the placeholder clips)")
        return
    out = os.path.join(OUT_VID, name)
    subprocess.run([ff, "-y", "-loglevel", "error", "-loop", "1", "-i", poster_path,
                    "-t", "4", "-r", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-vf", "scale=720:1280", "-movflags", "+faststart", out], check=True)
    print(f"  {out}  {os.path.getsize(out) // 1024} KB")

print("posters:")
p1 = poster("post-1.jpg", "A post from the studio")
p2 = poster("post-2.jpg", "A post from the studio")
poster("post-3.jpg", "A post from the studio")
print("clips:")
clip(p1, "post-1.mp4")
clip(p2, "post-2.mp4")
