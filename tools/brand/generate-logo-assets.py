"""
JainERP logo assets — every web app and both desktops, from one source.

The logo (2026-10-16) is the Devanagari जैन in Gotu (#ff751f) followed by ERP
in Boston Angel Light (#000000; navy #00167a until 2026-10-16). Neither font ships with the apps: the glyphs
were outlined from the designer's PDF into jainerp-logo-outlines.json, so the
logo renders identically everywhere without loading a font.

Writes, per web app (public/):
  logo.svg            the logo, for light backgrounds
  logo-on-dark.svg    the same with ERP in white, for dark backgrounds
  favicon.svg         जैन on a white rounded tile (the full logo is unreadable at tab size)
  favicon-32.png, apple-touch-icon.png
and per desktop: screens/logo.svg, plus assets/icon.png (512) and icon.ico with the portal label;
and per phone app: Android launcher icons (adaptive + monochrome + PNG), the cold-start
image, the iOS icon set and launch image, and packages/ui/.../jainerp_logo_paths.dart.

Run from the repo root:  py -3 apps/mandiradmin-web/tools/brand/generate-logo-assets.py
Needs: pymupdf (renders the SVG), pillow, and Noto Sans Bold for the label.
"""
import io
import json
import os
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
SRC = json.load(open(os.path.join(HERE, 'jainerp-logo-outlines.json'), encoding='utf-8'))
W, H = SRC['width'], SRC['height']

# Local folders still use the old names; the GitHub repos use the new ones.
WEBS = [('mandiradmin-web', 'mandir-web'), ('devotee-web',), ('maharaj-web', 'sant-web'),
        ('superadmin-web',), ('website',)]
DESKTOPS = [(('mandiradmin-desktop', 'mandir-desktop'), 'Temple/Trust'),
            (('mandiradmin-desktop-offline',), 'Temple/Trust')]
LABEL_COLOUR = '#64748B'
LABEL_FONTS = ['C:/Windows/Fonts/NotoSans-Bold.ttf', '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf']


def app_dir(names):
    for n in names:
        p = os.path.join(ROOT, 'apps', n)
        if os.path.isdir(p):
            return p
    return None


def paths(erp_colour=None):
    return (f'<path fill="{SRC["jain"]["color"]}" d="{SRC["jain"]["d"]}"/>'
            f'<path fill="{erp_colour or SRC["erp"]["color"]}" d="{SRC["erp"]["d"]}"/>')


def logo_svg(erp_colour=None):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="JainERP">'
            f'<title>JainERP</title>{paths(erp_colour)}</svg>\n')


# जैन alone occupies x 0..JAIN_W of the outline box (ERP starts after it).
JAIN_W = SRC['jain_width']


def tile_svg(size=64, pad=0.07, jain_only=False):
    """On a white rounded square. A browser tab is 16-32 px, where the whole
    logo is a smudge, so the favicon is जैन alone; touch icons get it all."""
    w = JAIN_W if jain_only else W
    s = size * (1 - 2 * pad) / max(w, H)
    x = (size - w * s) / 2
    y = (size - H * s) / 2
    inner = f'<path fill="{SRC["jain"]["color"]}" d="{SRC["jain"]["d"]}"/>' if jain_only else paths()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="JainERP">'
            f'<title>JainERP</title><rect width="{size}" height="{size}" rx="{size * 0.16:g}" fill="#FFFFFF"/>'
            f'<g transform="translate({x:.3f} {y:.3f}) scale({s:.5f})">{inner}</g></svg>\n')


def render(svg, px, alpha=True):
    doc = pymupdf.open(stream=svg.encode('utf-8'), filetype='svg')
    page = doc[0]
    zoom = px / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=alpha)
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')


def desktop_icon(label):
    size = 512
    img = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    logo_w = int(size * 0.80)
    logo = render(logo_svg(), logo_w)
    font = next((ImageFont.truetype(f, 44) for f in LABEL_FONTS if os.path.exists(f)), None)
    if font is None:
        sys.exit('Noto Sans Bold not found — install it for the desktop icon label')
    d = ImageDraw.Draw(img)
    lb = d.textbbox((0, 0), label, font=font)
    gap = 26
    total = logo.height + gap + (lb[3] - lb[1])
    top = (size - total) // 2
    img.alpha_composite(logo, ((size - logo.width) // 2, top))
    d.text(((size - (lb[2] - lb[0])) // 2 - lb[0], top + logo.height + gap - lb[1]), label, font=font, fill=LABEL_COLOUR)
    return img


def og_image():
    """jainerp.org's link preview (1200x630): logo, tagline, feature pills."""
    w, h = 1200, 630
    img = Image.new('RGBA', (w, h))
    top, bottom = (0x0d, 0x1b, 0x2e), (0x1b, 0x2f, 0x4a)  # the UI's navy-900 -> navy-700
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, (x / w) * 0.45 + (y / h) * 0.55)
            px[x, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(260, 0, -4):  # a soft saffron glow, top right
        gd.ellipse((1040 - r, 140 - r, 1040 + r, 140 + r), fill=(0xff, 0x75, 0x1f, int(46 * (1 - r / 260) ** 1.6)))
    img.alpha_composite(glow)
    logo = render(logo_svg('#FFFFFF'), 330)
    img.alpha_composite(logo, (80, 120))
    font = lambda size: ImageFont.truetype(next(f for f in LABEL_FONTS if os.path.exists(f)), size)
    d = ImageDraw.Draw(img)
    y = 120 + logo.height + 36
    for line in ['Temple & trust management — donations, 80G', 'receipts, seva, dharamshala, prasad and full', 'accounting.']:
        d.text((80, y), line, font=font(34), fill='#e2e8f0'); y += 47
    x, y = 80, y + 38
    deva = 'C:/Windows/Fonts/Nirmala.ttc'
    for pill in ['Offline desktop', 'Cloud portals — live', 'WhatsApp receipts', 'English · हिंदी · मराठी']:
        f = ImageFont.truetype(deva, 22) if os.path.exists(deva) and any(0x900 <= ord(c) <= 0x97f for c in pill) else font(22)
        tw = d.textlength(pill, font=f)
        d.rounded_rectangle((x, y, x + tw + 48, y + 56), radius=28, outline='#64748b', width=2)
        d.text((x + 24, y + 28), pill, font=f, fill='#ffd9bf', anchor='lm')
        x += tw + 48 + 16
    d.text((80, h - 60), 'jainerp.org', font=font(24), fill='#94a3b8')
    return img.convert('RGB')


# ── Phone apps ───────────────────────────────────────────────────────────────
# Local folder, portal label (the app's own brandPortal string).
MOBILES = [(('mandiradmin-mobile', 'mandir-mobile'), 'Temple/Trust'),
           (('devotee-mobile',), 'Bhakt'),
           (('maharaj-mobile', 'sant-mobile'), 'Sant')]
DENSITIES = (('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4))
LAUNCHER_DP = 48        # legacy launcher icon
LAUNCH_IMAGE_DP = 200   # cold-start lockup width
IOS_ICONS = [('Icon-App-20x20@1x.png', 20), ('Icon-App-20x20@2x.png', 40), ('Icon-App-20x20@3x.png', 60),
             ('Icon-App-29x29@1x.png', 29), ('Icon-App-29x29@2x.png', 58), ('Icon-App-29x29@3x.png', 87),
             ('Icon-App-40x40@1x.png', 40), ('Icon-App-40x40@2x.png', 80), ('Icon-App-40x40@3x.png', 120),
             ('Icon-App-60x60@2x.png', 120), ('Icon-App-60x60@3x.png', 180), ('Icon-App-76x76@1x.png', 76),
             ('Icon-App-76x76@2x.png', 152), ('Icon-App-83.5x83.5@2x.png', 167), ('Icon-App-1024x1024@1x.png', 1024)]
LABEL_EM = 0.30 * H     # portal label size, in logo units
LABEL_GAP = 0.10 * H    # logo ink to label ink


def label_outline(text):
    """The portal label as one path (Noto Sans Bold), ink box at (0, 0)."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    path = next((f for f in LABEL_FONTS if os.path.exists(f)), None)
    if not path:
        sys.exit('Noto Sans Bold not found — install it for the portal label')
    font = TTFont(path)
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    s = LABEL_EM / font['head'].unitsPerEm

    def draw(pen, dx, dy):
        x = 0.0
        for ch in text:
            g = cmap[ord(ch)]
            gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x + dx, dy)))
            x += gs[g].width * s
    b = BoundsPen(gs); draw(b, 0, 0)
    x0, y0, x1, y1 = b.bounds
    p = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.')); draw(p, -x0, -y0)
    return p.getCommands(), x1 - x0, y1 - y0


def lockup(label, mono=None):
    """Logo with the portal label centred beneath: (width, height, svg-inner)."""
    d, lw, lh = label_outline(label)
    width = max(W, lw)
    lx, ly, ox = (width - lw) / 2, H + LABEL_GAP, (width - W) / 2
    jain, erp, lab = (mono or SRC['jain']['color']), (mono or SRC['erp']['color']), (mono or LABEL_COLOUR)
    inner = (f'<g transform="translate({ox:.2f} 0)"><path fill="{jain}" d="{SRC["jain"]["d"]}"/>'
             f'<path fill="{erp}" d="{SRC["erp"]["d"]}"/></g>'
             f'<g transform="translate({lx:.2f} {ly:.2f})"><path fill="{lab}" d="{d}"/></g>')
    return width, ly + lh, inner, (ox, lx, ly, d, jain, erp, lab)


def plate_svg(iw, ih, inner, size, pad, radius, plate=True):
    s = size * (1 - 2 * pad) / max(iw, ih)
    x, y = (size - iw * s) / 2, (size - ih * s) / 2
    rect = f'<rect width="{size}" height="{size}" rx="{size * radius:g}" fill="#FFFFFF"/>' if plate else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{rect}'
            f'<g transform="translate({x:.3f} {y:.3f}) scale({s:.5f})">{inner}</g></svg>\n')


def android_vector(label, mono=None, fit=56.0, note=''):
    """Adaptive-icon layer on the 108dp canvas. The tightest launcher mask is a
    66dp circle, so the whole block's diagonal — not just its width — must fit."""
    lw, lh, _, (ox, lx, ly, d, jain, erp, lab) = lockup(label, mono)
    s = fit / lw
    if ((lw * s) ** 2 + (lh * s) ** 2) ** 0.5 / 2 > 33:
        sys.exit('lockup escapes the 66dp mask circle — lower `fit`')
    tx, ty = (108 - lw * s) / 2, (108 - lh * s) / 2
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            f'<!--\n  {note}\n\n  Generated by mandir-web/tools/brand/generate-logo-assets.py -\n'
            '  edit the script, not this file.\n-->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="108dp" android:height="108dp"\n'
            '    android:viewportWidth="108" android:viewportHeight="108">\n'
            f'    <group android:translateX="{tx:.3f}" android:translateY="{ty:.3f}"'
            f' android:scaleX="{s:.5f}" android:scaleY="{s:.5f}">\n'
            f'        <group android:translateX="{ox:.2f}">\n'
            f'            <path android:fillColor="{jain}" android:pathData="{SRC["jain"]["d"]}" />\n'
            f'            <path android:fillColor="{erp}" android:pathData="{SRC["erp"]["d"]}" />\n'
            '        </group>\n'
            f'        <group android:translateX="{lx:.2f}" android:translateY="{ly:.2f}">\n'
            f'            <path android:fillColor="{lab}" android:pathData="{d}" />\n'
            '        </group>\n'
            '    </group>\n'
            '</vector>\n')


def dart_path(d):
    """SVG path data (absolute M/L/H/V/Q/C/Z, as fontTools writes it) as Dart."""
    import re
    toks = re.findall(r'[MLHVQCZ]|-?\d*\.?\d+(?:e-?\d+)?', d)
    arity = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'Q': 4, 'C': 6, 'Z': 0}
    out, i, cmd, cx, cy = [], 0, None, 0.0, 0.0
    f = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')
    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]; i += 1
            if cmd == 'Z':
                out.append('..close()'); continue
        n = arity[cmd]
        a = [float(t) for t in toks[i:i + n]]; i += n
        if cmd == 'M':
            out.append(f'..moveTo({f(a[0])}, {f(a[1])})'); cx, cy = a; cmd = 'L'
        elif cmd == 'L':
            out.append(f'..lineTo({f(a[0])}, {f(a[1])})'); cx, cy = a
        elif cmd == 'H':
            cx = a[0]; out.append(f'..lineTo({f(cx)}, {f(cy)})')
        elif cmd == 'V':
            cy = a[0]; out.append(f'..lineTo({f(cx)}, {f(cy)})')
        elif cmd == 'Q':
            out.append(f'..quadraticBezierTo({", ".join(map(f, a))})'); cx, cy = a[2], a[3]
        elif cmd == 'C':
            out.append(f'..cubicTo({", ".join(map(f, a))})'); cx, cy = a[4], a[5]
    return out


def dart_file():
    def fn(name, d):
        body = '\n'.join('    ' + s for s in dart_path(d))
        return f'Path {name}() => Path()\n{body};\n'
    hexc = lambda c: '0xFF' + c.lstrip('#').upper()
    return ('// GENERATED by mandir-web/tools/brand/generate-logo-assets.py from the\n'
            "// designer's artwork (jainerp-logo-outlines.json). Edit the script, not this file.\n"
            '//\n// Vendored identically into every phone app.\n'
            "import 'dart:ui';\n\n"
            f'const double kLogoWidth = {W};\nconst double kLogoHeight = {H};\n'
            f'const Color kLogoJainColor = Color({hexc(SRC["jain"]["color"])});\n'
            f'const Color kLogoErpColor = Color({hexc(SRC["erp"]["color"])});\n\n'
            '/// जैन, in logo units (kLogoWidth x kLogoHeight, origin top-left).\n'
            + fn('logoJainPath', SRC['jain']['d']) +
            '\n/// ERP, in the same units.\n' + fn('logoErpPath', SRC['erp']['d']))


def write_png(path, img):
    img.save(path, optimize=True)
    print('  wrote', os.path.relpath(path, ROOT))


def mobile(d, label):
    res = os.path.join(d, 'app', 'android', 'app', 'src', 'main', 'res')
    lw, lh, inner, _ = lockup(label)
    wide = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {lw:.2f} {lh:.2f}">{inner}</svg>\n'
    legacy = plate_svg(lw, lh, inner, 512, 0.10, 0.18)
    flat = plate_svg(lw, lh, inner, 1024, 0.10, 0)
    for bucket, k in DENSITIES:
        write_png(os.path.join(res, f'mipmap-{bucket}', 'ic_launcher.png'), render(legacy, round(LAUNCHER_DP * k)))
        write_png(os.path.join(res, f'mipmap-{bucket}', 'launch_image.png'), render(wide, round(LAUNCH_IMAGE_DP * k)))
    write(os.path.join(res, 'drawable', 'ic_launcher_foreground.xml'), android_vector(
        label, note="Adaptive launcher icon, foreground layer: the JainERP logo over the\n  app's portal label. The white plate is the background layer."))
    write(os.path.join(res, 'drawable', 'ic_launcher_monochrome.xml'), android_vector(
        label, mono='#FFFFFF', note='Themed-icon layer (Android 13+). The launcher tints this, so it ships\n  as one flat colour.'))
    xc = os.path.join(d, 'app', 'ios', 'Runner', 'Assets.xcassets')
    for name, size in IOS_ICONS:  # iOS masks the corners itself and rejects alpha
        bg = Image.new('RGBA', (size, size), (255, 255, 255, 255)); bg.alpha_composite(render(flat, size))
        write_png(os.path.join(xc, 'AppIcon.appiconset', name), bg.convert('RGB'))
    for suffix, k in (('', 1), ('@2x', 2), ('@3x', 3)):
        write_png(os.path.join(xc, 'LaunchImage.imageset', f'LaunchImage{suffix}.png'), render(wide, LAUNCH_IMAGE_DP * k))
    write(os.path.join(d, 'packages', 'ui', 'lib', 'src', 'brand', 'jainerp_logo_paths.dart'), dart_file())


def write(path, data):
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(path, mode, **({} if mode == 'wb' else {'encoding': 'utf-8', 'newline': '\n'})) as f:
        f.write(data)
    print('  wrote', os.path.relpath(path, ROOT))


def main():
    for names in WEBS:
        d = app_dir(names)
        if not d:
            print('skip (not here):', names[0]); continue
        pub = os.path.join(d, 'public')
        write(os.path.join(pub, 'logo.svg'), logo_svg())
        write(os.path.join(pub, 'logo-on-dark.svg'), logo_svg('#FFFFFF'))
        write(os.path.join(pub, 'favicon.svg'), tile_svg(jain_only=True))
        render(tile_svg(jain_only=True), 32).save(os.path.join(pub, 'favicon-32.png')); print('  wrote favicon-32.png')
        # iOS rounds the corners itself, so the touch icon is a full white square.
        touch = Image.new('RGBA', (180, 180), (255, 255, 255, 255))
        touch.alpha_composite(render(tile_svg(), 180))
        touch.convert('RGB').save(os.path.join(pub, 'apple-touch-icon.png')); print('  wrote apple-touch-icon.png')
        if names[0] == 'website':
            og_image().save(os.path.join(pub, 'og-image.png')); print('  wrote og-image.png')
    for names, label in DESKTOPS:
        d = app_dir(names)
        if not d:
            print('skip (not here):', names[0]); continue
        # The desktop's own screens (login, licence, PIN…) load it from disk.
        write(os.path.join(d, 'screens', 'logo.svg'), logo_svg())
        icon = desktop_icon(label)
        icon.save(os.path.join(d, 'assets', 'icon.png'))
        icon.save(os.path.join(d, 'assets', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print('  wrote', names[0], 'icon.png + icon.ico')
    for names, label in MOBILES:
        d = app_dir(names)
        if not d:
            print('skip (not here):', names[0]); continue
        mobile(d, label)


if __name__ == '__main__':
    main()
