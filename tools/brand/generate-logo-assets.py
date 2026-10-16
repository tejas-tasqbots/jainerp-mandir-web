"""
JainERP logo assets — every web app and both desktops, from one source.

The logo (2026-10-16) is the Devanagari जैन in Gotu (#ff751f) followed by ERP
in Boston Angel Light (#00167a). Neither font ships with the apps: the glyphs
were outlined from the designer's PDF into jainerp-logo-outlines.json, so the
logo renders identically everywhere without loading a font.

Writes, per web app (public/):
  logo.svg            the logo, for light backgrounds
  logo-on-dark.svg    the same with ERP in white, for dark backgrounds
  favicon.svg         जैन on a white rounded tile (the full logo is unreadable at tab size)
  favicon-32.png, apple-touch-icon.png
and per desktop: screens/logo.svg, plus assets/icon.png (512) and icon.ico with the portal label.

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


if __name__ == '__main__':
    main()
