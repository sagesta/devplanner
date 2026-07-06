"""Generate the PWA icon set for apps/web.

Usage: python scripts/make_pwa_icons.py

Outputs (all derived from one 1024px master render):
  apps/web/public/icon-192.png        - manifest icon
  apps/web/public/icon-512.png        - manifest icon
  apps/web/public/apple-touch-icon.png - iOS home-screen icon (180px)
  apps/web/app/icon.png               - favicon (64px, auto-served by Next)

Design: full-bleed teal gradient with a white lightning bolt (matches the
"Today" Zap branding). The bolt stays inside the central 80% so the same
art works as a maskable icon on Android launchers.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "web" / "public"
APP = ROOT / "apps" / "web" / "app"

SIZE = 1024
GRADIENT_TOP = (2, 138, 145)  # --primary-hover #018a91
GRADIENT_BOTTOM = (1, 86, 91)  # darkened primary
BOLT_COLOR = (247, 246, 242)  # --foreground #f7f6f2

# Lucide-style zap polygon on a 512 canvas, scaled to the maskable safe zone.
BOLT_512 = [(292, 48), (160, 296), (244, 296), (220, 464), (352, 216), (268, 216)]
SAFE_SCALE = 0.82


def bolt_points(size: int) -> list[tuple[float, float]]:
    c = 256.0
    k = (size / 512.0) * SAFE_SCALE
    off = size / 2.0
    return [((x - c) * k + off, (y - c) * k + off) for x, y in BOLT_512]


def render_master() -> Image.Image:
    img = Image.new("RGB", (SIZE, SIZE))
    d = ImageDraw.Draw(img)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        row = tuple(round(a + (b - a) * t) for a, b in zip(GRADIENT_TOP, GRADIENT_BOTTOM))
        d.line([(0, y), (SIZE, y)], fill=row)
    d.polygon(bolt_points(SIZE), fill=BOLT_COLOR)
    return img


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    master = render_master()
    for size, path in [
        (512, PUBLIC / "icon-512.png"),
        (192, PUBLIC / "icon-192.png"),
        (180, PUBLIC / "apple-touch-icon.png"),
        (64, APP / "icon.png"),
    ]:
        master.resize((size, size), Image.LANCZOS).save(path)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
