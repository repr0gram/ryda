#!/usr/bin/env python3
"""
Turn a rendered icon mockup into an iOS app icon.

The source is a picture *of* an icon: a dark rounded square floating on a light
background with a drop shadow. iOS wants the opposite — a full-bleed square with
no rounding, no alpha and no shadow, because the system applies its own mask and
shadow. Handing it the mockup verbatim produces an icon with a second, smaller
icon drawn inside it.

So: find the dark square, crop it, and repaint the rounded corners with the
square's own colour so the result is genuinely square.

Two details that are easy to get wrong and very visible at 60px on a home
screen. The crop is eroded a few pixels past the detected edge, because the
boundary between square and background is anti-aliased and a mask laid exactly
on it leaves a pale rim tracing the corners. And the corner fill is sampled per
corner from just inside the arc, because the source carries a diagonal
gradient — one flat black would read as four patches.

    python3 scripts/make-app-icon.py <source.png> <out.png> [size]
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

LUMA_DARK = 90  # below this a pixel belongs to the square, not the background


def dark_bounds(image):
    """Bounding box of the dark square, ignoring the soft shadow around it."""
    grey = image.convert("L")
    mask = grey.point(lambda v: 255 if v < LUMA_DARK else 0).filter(ImageFilter.MedianFilter(5))
    box = mask.getbbox()
    if box is None:
        raise SystemExit("no dark region found — is this the right image?")
    return box


def corner_radius(grey, box):
    """Infer the corner radius by walking in along the square's top edge."""
    left, top, right, _ = box
    width = right - left
    for x in range(left, left + width // 2):
        if grey.getpixel((x, top + 1)) < LUMA_DARK:
            return max(1, x - left)
    return width // 5


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    source, destination = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024

    image = Image.open(source).convert("RGB")
    box = dark_bounds(image)
    radius = corner_radius(image.convert("L"), box)

    left, top, right, bottom = box
    # Step inside the anti-aliased boundary, then take a true square centred on
    # the detected region — a render is rarely square to the pixel.
    rim = max(2, round((right - left) * 0.01))
    side = min(right - left, bottom - top) - 2 * rim
    cx, cy = (left + right) // 2, (top + bottom) // 2
    square = image.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
    w, h = square.size
    radius = max(1, radius - rim)
    print(f"source {image.size[0]}x{image.size[1]} · square {w}x{h} · radius ~{radius}px")

    outside = Image.new("L", (w, h), 255)
    ImageDraw.Draw(outside).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=0)

    # Just inside the arc on each diagonal: the arc is centred at (R, R) with
    # radius R, so (0.35R, 0.35R) sits within the shape but close to the corner.
    s = max(1, round(radius * 0.35))
    fills = Image.new("RGB", (w, h))
    painter = ImageDraw.Draw(fills)
    for x0, y0, x1, y1, sx, sy in (
        (0, 0, w // 2, h // 2, s, s),
        (w // 2, 0, w, h // 2, w - s, s),
        (0, h // 2, w // 2, h, s, h - s),
        (w // 2, h // 2, w, h, w - s, h - s),
    ):
        painter.rectangle([x0, y0, x1, y1], fill=square.getpixel((sx, sy)))
    square.paste(fills, (0, 0), outside)

    icon = square.resize((size, size), Image.LANCZOS).convert("RGB")

    # The corners must actually be dark now; a pale one means the erosion did
    # not clear the rim and the icon will show a halo under the system mask.
    for name, xy in (
        ("top-left", (1, 1)),
        ("top-right", (size - 2, 1)),
        ("bottom-left", (1, size - 2)),
        ("bottom-right", (size - 2, size - 2)),
    ):
        r, g, b = icon.getpixel(xy)
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        status = "ok" if luma < LUMA_DARK else "PALE — rim not cleared"
        print(f"  {name:13s} rgb({r},{g},{b}) luma {luma:5.1f}  {status}")

    # No alpha: the App Store rejects icons with one, and these are opaque.
    icon.save(destination, "PNG")
    print(f"wrote {destination} at {size}x{size}")


if __name__ == "__main__":
    main()
