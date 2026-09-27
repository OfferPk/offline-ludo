"""Builds the Play Store graphics from real in-game captures in store/raw/ (made by store/capture_screens.js).
  store/screenshots/01..07.png  1080x1920 captioned screenshots
  store/feature-graphic-1024x500.png
Run from the repo root: python3 store/make_store_art.py  (needs Pillow)"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'assets'))
import make_icon  # noqa: E402

FONT_DIR = '/usr/share/fonts/truetype/sand-box/google'
SERIF = os.path.join(FONT_DIR, 'Inter/Inter-VariableFont_opsz,wght.ttf')
SANS = SERIF
INK = (240, 243, 248)
BLUE = (244, 183, 64)
MUTED = (150, 160, 178)


def font(path, size, style=None):
    f = ImageFont.truetype(path, size)
    if style:
        try:
            f.set_variation_by_name(style)
        except Exception:
            pass
    return f


CAPTIONS = [
    ('01', '1-dice', 'Your own dice, your corner', 'Stack your 6s: roll again, then pick chip + token'),
    ('02', '3-wheel', 'New: Mystery Tiles', '? and ! tiles spin wheels of surprise events'),
    ('03', '2-capture', 'Capture and race home', 'Bonus roll for every capture and every token home'),
    ('04', '4-chat', 'Quick chat & emotes', 'Computer players react. 1 v 1 or 4 players'),
    ('05', '5-rules', 'Play by your house rules', 'Star style or Classic, blocks, undo roll & more'),
    ('06', '6-win', 'Ranked results, coins & XP', 'Coins unlock cosmetic skins only'),
    ('07', '7-walnut', 'Pass & play, fully offline', 'Stylish skins. No internet, no login'),
]


def bg(w, h):
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=make_icon.lerp((34, 40, 52), (12, 14, 19), (y / h) ** 0.8))
    return im.convert('RGBA')


def fit_font(path, text, max_w, start, style=None):
    size = start
    while size > 20:
        f = font(path, size, style)
        if f.getlength(text) <= max_w:
            return f
        size -= 4
    return font(path, size, style)


def rounded(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def screenshot(num, raw, title, sub):
    W, H = 1080, 1920
    canvas = bg(W, H)
    d = ImageDraw.Draw(canvas)
    ft = fit_font(SERIF, title, W - 110, 100, 'ExtraBold')
    tw = ft.getlength(title)
    d.text(((W - tw) / 2, 70), title, font=ft, fill=INK)
    tb = d.textbbox(((W - tw) / 2, 70), title, font=ft)[3]
    d.rounded_rectangle([(W / 2 - 50, tb + 24), (W / 2 + 50, tb + 29)], 3, fill=BLUE)
    fs = fit_font(SANS, sub, W - 140, 44, 'Medium')
    sw = fs.getlength(sub)
    d.text(((W - sw) / 2, tb + 52), sub, font=fs, fill=MUTED)
    shot = Image.open(os.path.join(HERE, 'raw', raw + '.png')).convert('RGB')
    top = tb + 52 + fs.size + 56
    sh_h = H - top - 60
    sh_w = int(shot.width * sh_h / shot.height)
    shot = shot.resize((sh_w, sh_h), Image.LANCZOS)
    x = (W - sh_w) // 2
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x - 14, top + 6, x + sh_w + 14, top + sh_h + 34], 60, fill=(0, 0, 0, 150))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(24)))
    frame = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([x - 14, top - 14, x + sh_w + 14, top + sh_h + 14], 58, fill=(28, 32, 40, 255), outline=(70, 78, 94, 255), width=3)
    canvas = Image.alpha_composite(canvas, frame)
    canvas.alpha_composite(rounded(shot, 46), (x, top))
    out = os.path.join(HERE, 'screenshots', num + '.png')
    canvas.convert('RGB').save(out, optimize=True)
    return out


def feature():
    W, H = 1024, 500
    canvas = bg(W, H)
    art = Image.new('RGBA', (1200, 1200), (0, 0, 0, 0))
    make_icon.draw_art(art, 0.86)
    art = art.resize((380, 380), Image.LANCZOS)
    canvas.alpha_composite(art, (W - 380 - 16, (H - 380) // 2))
    d = ImageDraw.Draw(canvas)
    d.text((64, 110), 'Crossfour', font=font(SERIF, 100, 'ExtraBold'), fill=INK)
    d.text((70, 248), 'OFFLINE LUDO', font=font(SANS, 36, 'Bold'), fill=BLUE)
    d.rounded_rectangle([(70, 312), (170, 318)], 3, fill=BLUE)
    d.text((70, 340), '2-4 players · vs computer · Mystery Tiles', font=font(SANS, 27, 'Medium'), fill=MUTED)
    d.text((70, 378), 'Stacked sixes · pass & play · no internet', font=font(SANS, 27, 'Medium'), fill=MUTED)
    out = os.path.join(HERE, 'feature-graphic-1024x500.png')
    canvas.convert('RGB').save(out, optimize=True)
    return out


if __name__ == '__main__':
    os.makedirs(os.path.join(HERE, 'screenshots'), exist_ok=True)
    for c in CAPTIONS:
        print(screenshot(*c))
    print(feature())
