#!/usr/bin/env bash
# Resize and compress a photo for the Glisk site.
#
#   ./scripts/process-photo.sh ~/Downloads/IMG_4821.jpg fleur-portrait
#
# Writes assets/img/<name>.jpg at the right size for its slot.
# Needs imagemagick:  brew install imagemagick   /   sudo apt install imagemagick

set -euo pipefail

SRC="${1:?usage: process-photo.sh <source-image> <slot-name>}"
NAME="${2:?usage: process-photo.sh <source-image> <slot-name>}"
OUT="assets/img/${NAME}.jpg"

case "$NAME" in
  fleur-portrait)  GEOM="800x1000^";   CROP="800x1000" ;;   # 4:5 portrait
  treatment-room)  GEOM="1600x1000^";  CROP="1600x1000" ;;  # 8:5 wide
  home-visit)      GEOM="1600x1000^";  CROP="1600x1000" ;;
  og|og-voucher)   GEOM="1200x630^";   CROP="1200x630" ;;   # social preview
  *)               GEOM="1600x";       CROP="" ;;           # generic: cap width
esac

if [ -n "$CROP" ]; then
  magick "$SRC" -auto-orient -resize "$GEOM" -gravity center -extent "$CROP" \
         -strip -quality 82 -interlace Plane "$OUT"
else
  magick "$SRC" -auto-orient -resize "$GEOM" -strip -quality 82 -interlace Plane "$OUT"
fi

echo "wrote $OUT"
ls -lh "$OUT" | awk '{print "  size:", $5}'
magick identify -format "  dimensions: %wx%h\n" "$OUT"

SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
if [ "$SIZE" -gt 300000 ]; then
  echo "  ⚠  over 300KB — consider -quality 75"
fi
