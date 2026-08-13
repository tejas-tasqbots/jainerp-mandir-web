#!/usr/bin/env python3
"""Generate every JainERP logo / favicon / app-icon asset from the wordmark.

THE LOGO IS TEXT AND COLOUR, NOTHING ELSE
-----------------------------------------
"JainERP" set in Noto Sans Bold — the same family the portals load — with
"Jain" in brand navy (#0D1B2E) and "ERP" in brand red (#D62828), on one line.
Under it, each app prints its own portal label ("Temple/Trust", "Devotee",
"Sant"), in slate. There is no icon, badge or illustration in the mark.

Because it is only text, this script builds it from the font's own outlines
(fontTools) rather than shipping a hand-drawn path: the letterforms are exactly
what the login header and the sidebar render in HTML, so the tab icon, the
launcher icon and the in-app logo cannot drift apart. Glyphs become paths so no
consumer needs the font — SVG favicons, Android VectorDrawables and iOS PNGs
all have to stand alone.

WHAT IT WRITES  (all committed; no app build runs this script)
  <web>/public/favicon.svg            square lockup, white plate
  <web>/public/favicon-32.png         raster fallback for old browsers
  <web>/public/apple-touch-icon.png   180px, opaque (iOS home screen)
  <web>/public/logo.svg               wordmark only, transparent, tight box
  <mobile>/app/android/.../mipmap-*/ic_launcher.png     legacy launcher icon
  <mobile>/app/android/.../mipmap-*/launch_image.png    launch (cold-start) screen
  <mobile>/app/android/.../drawable/ic_launcher_foreground.xml   adaptive icon
  <mobile>/app/android/.../drawable/ic_launcher_monochrome.xml   themed icon
  <mobile>/app/ios/.../AppIcon.appiconset/*.png         all 19 iOS sizes
  mandir-desktop/assets/icon.png|.ico                   electron-builder icons

USAGE
  python3 tools/brand/generate-brand-assets.py            # write into every repo
  python3 tools/brand/generate-brand-assets.py --out /tmp/x   # preview only
  python3 tools/brand/generate-brand-assets.py --list      # just print targets

REQUIREMENTS (dev-only, install in a venv — Ubuntu blocks system pip)
  python3 -m venv .venv && .venv/bin/pip install fonttools cairosvg pillow
fonttools reads the glyph outlines, cairosvg rasterises the SVG we just built
(so every PNG is the same drawing as the SVG), pillow packs the Windows .ico.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass, field

# ── brand ────────────────────────────────────────────────────────────────────
NAVY = "#0D1B2E"  # navy-900 — "Jain"
RED = "#D62828"  # brand-red — "ERP"
LABEL = "#64748B"  # slate-500 — the portal label, same muted tone the UI uses
PLATE = "#FFFFFF"  # the logo is drawn on white, as supplied

WORDMARK = (("Jain", NAVY), ("ERP", RED))

# Type geometry, all relative to the wordmark's em so every size scales as one.
EM = 100.0
TRACKING = -0.02  # matches Tailwind's tracking-tight on the HTML wordmark
LABEL_RATIO = 0.40  # portal-label em, as a fraction of the wordmark em
LABEL_TRACKING = 0.04  # small caps-ish text needs air to stay legible when tiny
LABEL_GAP = 0.18  # space between wordmark ink and label ink

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
)

# ── targets ──────────────────────────────────────────────────────────────────
# label=None keeps the plain wordmark: the marketing site is the brand itself,
# not one of the portals.
WEBS = (
    ("mandir-web", "Temple/Trust"),
    ("devotee-web", "Devotee"),
    ("sant-web", "Sant"),
    ("superadmin-web", "Super Admin"),
    ("website", None),
)
MOBILES = (
    ("mandir-mobile", "Temple/Trust"),
    ("devotee-mobile", "Devotee"),
    ("sant-mobile", "Sant"),
)
DESKTOP = ("mandir-desktop", "Temple/Trust")

# Android density buckets: dp → px multiplier.
DENSITIES = (("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4))
LAUNCHER_DP = 48  # legacy launcher icon, in dp
LAUNCH_IMAGE_DP = 200  # cold-start splash lockup width, in dp

# (filename, pixel size) for Runner/Assets.xcassets/AppIcon.appiconset.
IOS_ICONS = (
    ("Icon-App-20x20@1x.png", 20),
    ("Icon-App-20x20@2x.png", 40),
    ("Icon-App-20x20@3x.png", 60),
    ("Icon-App-29x29@1x.png", 29),
    ("Icon-App-29x29@2x.png", 58),
    ("Icon-App-29x29@3x.png", 87),
    ("Icon-App-40x40@1x.png", 40),
    ("Icon-App-40x40@2x.png", 80),
    ("Icon-App-40x40@3x.png", 120),
    ("Icon-App-60x60@2x.png", 120),
    ("Icon-App-60x60@3x.png", 180),
    ("Icon-App-76x76@1x.png", 76),
    ("Icon-App-76x76@2x.png", 152),
    ("Icon-App-83.5x83.5@2x.png", 167),
    ("Icon-App-1024x1024@1x.png", 1024),
)


# ── font plumbing ────────────────────────────────────────────────────────────
def find_font() -> str:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    try:
        out = subprocess.run(
            ["fc-match", "--format=%{file}", "Noto Sans:style=Bold"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        out = ""
    if out and os.path.exists(out):
        return out
    sys.exit("Noto Sans Bold not found — install fonts-noto-core (the wordmark's font).")


def num(value: float) -> str:
    """Path numbers: 2dp is under a thousandth of the em, and Android's
    PathParser chokes on exponent notation, which %g would emit."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


class Font:
    def __init__(self, path: str):
        from fontTools.ttLib import TTFont

        self.path = path
        self._tt = TTFont(path)
        self.upem = self._tt["head"].unitsPerEm
        self.glyphs = self._tt.getGlyphSet()
        self.cmap = self._tt.getBestCmap()

    def _name(self, ch: str) -> str:
        try:
            return self.cmap[ord(ch)]
        except KeyError:
            sys.exit(f"{self.path} has no glyph for {ch!r}")

    def advance(self, ch: str, em: float) -> float:
        return self.glyphs[self._name(ch)].width * em / self.upem

    def draw(self, ch: str, em: float, x: float, baseline: float, pen) -> None:
        """Draw one glyph into `pen`, flipped into SVG's y-down space with its
        origin on the baseline (font units are y-up)."""
        from fontTools.misc.transform import Transform
        from fontTools.pens.transformPen import TransformPen

        scale = em / self.upem
        self.glyphs[self._name(ch)].draw(
            TransformPen(pen, Transform(scale, 0, 0, -scale, x, baseline))
        )


@dataclass
class Item:
    ch: str
    em: float
    colour: str
    x: float
    baseline: float


@dataclass
class Lockup:
    """A finished drawing: paths in a box whose top-left is (0, 0)."""

    width: float
    height: float
    paths: list[tuple[str, str]] = field(default_factory=list)

    @property
    def aspect(self) -> float:
        return self.width / self.height


def ink_box(font: Font, items: list[Item]) -> tuple[float, float, float, float]:
    from fontTools.pens.boundsPen import BoundsPen

    box = None
    for it in items:
        pen = BoundsPen(font.glyphs)
        font.draw(it.ch, it.em, it.x, it.baseline, pen)
        if pen.bounds is None:  # a space has no ink
            continue
        box = pen.bounds if box is None else (
            min(box[0], pen.bounds[0]), min(box[1], pen.bounds[1]),
            max(box[2], pen.bounds[2]), max(box[3], pen.bounds[3]),
        )
    if box is None:
        sys.exit("nothing to draw")
    return box


def run(font: Font, text: str, em: float, colour: str, tracking: float) -> tuple[list[Item], float]:
    items, x = [], 0.0
    for ch in text:
        items.append(Item(ch, em, colour, x, 0.0))
        x += font.advance(ch, em) + tracking * em
    return items, x - tracking * em  # no tracking hangs off the last glyph


def build(font: Font, label: str | None, mono: str | None = None) -> Lockup:
    """The lockup: wordmark on one line, portal label centred beneath it.

    Everything is measured off the *ink*, not the font's ascent/descent, so the
    drawing has no invisible padding — each consumer adds its own.
    """
    items: list[Item] = []
    x = 0.0
    for text, colour in WORDMARK:
        chunk, width = run(font, text, EM, colour, TRACKING)
        for it in chunk:
            it.x += x
        items += chunk
        x += width + TRACKING * EM  # runs are contiguous: "Jain" + "ERP"
    word_box = ink_box(font, items)

    if label:
        em = EM * LABEL_RATIO
        chunk, width = run(font, label, em, LABEL, LABEL_TRACKING)
        chunk_box = ink_box(font, chunk)
        dx = (word_box[0] + word_box[2]) / 2 - (chunk_box[0] + chunk_box[2]) / 2
        dy = word_box[3] + LABEL_GAP * EM - chunk_box[1]
        for it in chunk:
            it.x += dx
            it.baseline += dy
        items += chunk

    box = ink_box(font, items)
    from fontTools.pens.svgPathPen import SVGPathPen

    by_colour: dict[str, list[str]] = {}
    for it in items:
        pen = SVGPathPen(font.glyphs, ntos=num)
        font.draw(it.ch, it.em, it.x - box[0], it.baseline - box[1], pen)
        data = pen.getCommands()
        if data:
            by_colour.setdefault(mono or it.colour, []).append(data)
    return Lockup(
        width=box[2] - box[0],
        height=box[3] - box[1],
        paths=[(colour, " ".join(parts)) for colour, parts in by_colour.items()],
    )


# ── emitters ─────────────────────────────────────────────────────────────────
def svg_logo(lk: Lockup) -> str:
    paths = "\n  ".join(f'<path fill="{c}" d="{d}"/>' for c, d in lk.paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(lk.width)} {num(lk.height)}"'
        ' role="img" aria-label="JainERP">\n'
        "  <title>JainERP</title>\n"
        f"  {paths}\n"
        "</svg>\n"
    )


def svg_icon(lk: Lockup, size: int = 64, pad: float = 0.08, radius: float = 0.16) -> str:
    """Square icon: the same one-line lockup, centred on a white plate.

    The plate is not decoration — the wordmark is navy on white, so a
    transparent icon would disappear against a dark browser tab or launcher.
    """
    avail = size * (1 - 2 * pad)
    scale = min(avail / lk.width, avail / lk.height)
    tx = (size - lk.width * scale) / 2
    ty = (size - lk.height * scale) / 2
    paths = "\n    ".join(f'<path fill="{c}" d="{d}"/>' for c, d in lk.paths)
    rx = f' rx="{num(size * radius)}"' if radius else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"'
        ' role="img" aria-label="JainERP">\n'
        "  <title>JainERP</title>\n"
        f'  <rect width="{size}" height="{size}"{rx} fill="{PLATE}"/>\n'
        f'  <g transform="translate({num(tx)} {num(ty)}) scale({scale:.5f})">\n'
        f"    {paths}\n"
        "  </g>\n"
        "</svg>\n"
    )


def android_vector(lk: Lockup, fit: float = 60.0, note: str = "") -> str:
    """Adaptive-icon layer: 108dp canvas, artwork inside the safe circle.

    Only the middle 72dp of an adaptive icon is guaranteed visible, and the
    tightest launcher mask is a 66dp circle — so the whole block's diagonal,
    not just its width, has to fit: at this aspect ratio, 68dp of width already
    pushes the wordmark's top corners outside the circle and Pixel launchers
    would shave the J and the P. `fit` is the width that keeps the corners in.
    """
    scale = fit / lk.width
    half_diagonal = ((lk.width * scale) ** 2 + (lk.height * scale) ** 2) ** 0.5 / 2
    if half_diagonal > 33.0:
        sys.exit(f"lockup escapes the 66dp mask circle (half-diagonal {half_diagonal:.1f}dp) — lower `fit`")
    tx = (108 - lk.width * scale) / 2
    ty = (108 - lk.height * scale) / 2
    paths = "\n        ".join(
        f'<path\n            android:fillColor="{c}"\n            android:pathData="{d}" />'
        for c, d in lk.paths
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        f"<!--\n  {note}\n\n  Generated by mandir-web/tools/brand/generate-brand-assets.py —\n"
        "  edit the script, not this file.\n-->\n"
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="108dp"\n'
        '    android:height="108dp"\n'
        '    android:viewportWidth="108"\n'
        '    android:viewportHeight="108">\n\n'
        f'    <group\n        android:scaleX="{scale:.5f}"\n        android:scaleY="{scale:.5f}"\n'
        f'        android:translateX="{num(tx)}"\n        android:translateY="{num(ty)}">\n\n'
        f"        {paths}\n"
        "    </group>\n"
        "</vector>\n"
    )


def png(svg: str, width: int, height: int | None = None, opaque: bool = False) -> bytes:
    import cairosvg

    data = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=width,
        output_height=height or width,
        background_color=PLATE if opaque else None,
    )
    if not opaque:
        return data
    # iOS rejects an alpha channel in app icons, and cairosvg keeps one even
    # when it paints a background.
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.open(io.BytesIO(data)).convert("RGB").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def ico(svg: str) -> bytes:
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(png(svg, 256)))
    buf = io.BytesIO()
    img.save(buf, "ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return buf.getvalue()


# ── writing ──────────────────────────────────────────────────────────────────
class Writer:
    def __init__(self, root: str, out: str | None, dry: bool):
        self.root, self.out, self.dry = root, out, dry
        self.written: list[str] = []

    def path(self, rel: str) -> str:
        return os.path.join(self.out, rel) if self.out else os.path.join(self.root, rel)

    def write(self, rel: str, data: bytes | str) -> None:
        target = self.path(rel)
        self.written.append(rel)
        if self.dry:
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        mode, payload = ("w", data) if isinstance(data, str) else ("wb", data)
        with open(target, mode) as fh:
            fh.write(payload)

    def drop(self, rel: str) -> None:
        target = self.path(rel)
        if self.out or not os.path.exists(target):
            return
        self.written.append(f"(removed) {rel}")
        if not self.dry:
            os.remove(target)


def generate(font: Font, root: str, out: str | None, dry: bool) -> list[str]:
    w = Writer(root, out, dry)
    apps = os.path.join("apps")

    for app, label in WEBS:
        lk = build(font, label)
        icon = svg_icon(lk)
        pub = os.path.join(apps, app, "public")
        w.write(os.path.join(pub, "favicon.svg"), icon)
        w.write(os.path.join(pub, "favicon-32.png"), png(icon, 32))
        w.write(os.path.join(pub, "apple-touch-icon.png"), png(svg_icon(lk, radius=0), 180, opaque=True))
        w.write(os.path.join(pub, "logo.svg"), svg_logo(build(font, None)))

    for app, label in MOBILES:
        lk = build(font, label)
        res = os.path.join(apps, app, "app", "android", "app", "src", "main", "res")
        legacy = svg_icon(lk, radius=0.18)
        wide = svg_logo(lk)
        for bucket, factor in DENSITIES:
            w.write(
                os.path.join(res, f"mipmap-{bucket}", "ic_launcher.png"),
                png(legacy, round(LAUNCHER_DP * factor)),
            )
            width = round(LAUNCH_IMAGE_DP * factor)
            w.write(
                os.path.join(res, f"mipmap-{bucket}", "launch_image.png"),
                png(wide, width, round(width / lk.aspect)),
            )
        w.write(
            os.path.join(res, "drawable", "ic_launcher_foreground.xml"),
            android_vector(lk, note="Adaptive launcher icon, foreground layer: the JainERP wordmark\n  over the app's portal label. The white plate is the background layer."),
        )
        w.write(
            os.path.join(res, "drawable", "ic_launcher_monochrome.xml"),
            android_vector(
                build(font, label, mono="#FFFFFF"),
                note="Themed-icon layer (Android 13+). The launcher tints this, so the\n  navy/red split cannot survive — it ships as one flat colour.",
            ),
        )
        # The temple/shikhara mark is no longer the product logo.
        w.drop(os.path.join(res, "drawable", "jainerp_mark.xml"))

        xcassets = os.path.join(apps, app, "app", "ios", "Runner", "Assets.xcassets")
        flat = svg_icon(lk, radius=0)  # iOS applies its own squircle mask
        for name, size in IOS_ICONS:
            w.write(os.path.join(xcassets, "AppIcon.appiconset", name), png(flat, size, opaque=True))
        # iOS launch screen: the storyboard centres LaunchImage on white, which
        # is the same composition as the Android launch window.
        for suffix, factor in (("", 1), ("@2x", 2), ("@3x", 3)):
            width = LAUNCH_IMAGE_DP * factor
            w.write(
                os.path.join(xcassets, "LaunchImage.imageset", f"LaunchImage{suffix}.png"),
                png(wide, width, round(width / lk.aspect)),
            )

    app, label = DESKTOP
    lk = build(font, label)
    assets = os.path.join(apps, app, "assets")
    w.write(os.path.join(assets, "icon.png"), png(svg_icon(lk, radius=0.18), 512))
    w.write(os.path.join(assets, "icon.ico"), ico(svg_icon(lk, radius=0.18)))
    return w.written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="write everything under this directory instead of the repos")
    ap.add_argument("--dry-run", action="store_true", help="list what would be written")
    ap.add_argument("--list", action="store_true", help="alias for --dry-run")
    args = ap.parse_args()

    # tools/brand/<this file> → mandir-web → apps → workspace root
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    if not os.path.isdir(os.path.join(root, "apps", "mandir-web")):
        sys.exit(f"expected the JainERP workspace at {root}")

    font = Font(find_font())
    written = generate(font, root, args.out, args.dry_run or args.list)
    where = args.out or root
    print(f"font:  {font.path}")
    print(f"{'would write' if (args.dry_run or args.list) else 'wrote'} {len(written)} files under {where}")
    for rel in written:
        print(f"  {rel}")


if __name__ == "__main__":
    main()
