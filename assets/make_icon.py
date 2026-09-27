"""Generates Crossfour's original launcher icons, adaptive foreground, splash images and store icons.
Art: four rounded quarter tiles in the seat colours (coral, jade, saffron, cobalt) forming a diamond,
with an ivory die in the middle, on a graphite background. Pure Pillow.
Run: python3 assets/make_icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
BG_TOP, BG_BOT = (38, 45, 58), (13, 16, 22)
SPLASH = (18, 21, 27)   # #12151B
SEATS = [(255, 111, 97), (47, 196, 157), (244, 183, 64), (77, 130, 255)]  # TL, TR, BR, BL
IVORY, PIP = (251, 250, 246), (31, 35, 43)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def shade(c, f):
    return tuple(int(v + (255 - v) * f) if f >= 0 else int(v * (1 + f)) for v in c)


def background(size):
    im = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(BG_TOP, BG_BOT, y / (size - 1)))
    glow = Image.new('L', (size, size), 0)
    ImageDraw.Draw(glow).ellipse([size * 0.15, size * 0.1, size * 0.85, size * 0.8], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.1))
    im.paste(Image.new('RGB', (size, size), (70, 84, 110)), (0, 0), glow)
    return im


def petal(size, col, corner):
    """Rounded tile with one extra-round outer corner (0 TL, 1 TR, 2 BR, 3 BL)."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    m = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(m)
    r, R = int(size * 0.2), int(size * 0.5)
    md.rounded_rectangle([0, 0, size - 1, size - 1], r, fill=255)
    # enlarge the outer corner radius
    cut = Image.new('L', (size, size), 0)
    cd = ImageDraw.Draw(cut)
    box = {0: (0, 0), 1: (size - R, 0), 2: (size - R, size - R), 3: (0, size - R)}[corner]
    cd.rectangle([box[0], box[1], box[0] + R, box[1] + R], fill=255)
    cx = R if corner in (0, 3) else size - R
    cy = R if corner in (0, 1) else size - R
    cd.ellipse([cx - R, cy - R, cx + R, cy + R], fill=0)
    m.paste(0, (0, 0), cut)
    g = Image.new('RGB', (size, size))
    gd = ImageDraw.Draw(g)
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(shade(col, 0.12), shade(col, -0.16), y / size))
    im.paste(g, (0, 0), m)
    return im


def draw_art(canvas, scale):
    """Draw the diamond centred on an RGBA canvas; scale = art width / canvas width."""
    W = canvas.size[0]
    A = int(W * scale / 1.414)          # unrotated square side
    gap = int(A * 0.07)
    t = (A - gap) // 2
    art = Image.new('RGBA', (A, A), (0, 0, 0, 0))
    pos = [(0, 0), (t + gap, 0), (t + gap, t + gap), (0, t + gap)]
    for k in range(4):
        art.alpha_composite(petal(t, SEATS[k], k), pos[k])
    # die in the middle
    dsz = int(A * 0.36)
    die = Image.new('RGBA', (dsz, dsz), (0, 0, 0, 0))
    dd = ImageDraw.Draw(die)
    dd.rounded_rectangle([0, 0, dsz - 1, dsz - 1], int(dsz * 0.22), fill=(0, 0, 0, 90))
    dd.rounded_rectangle([int(dsz * 0.05), int(dsz * 0.05), dsz - 1 - int(dsz * 0.05), dsz - 1 - int(dsz * 0.05)], int(dsz * 0.2), fill=IVORY + (255,))
    pr = dsz * 0.068
    for fx, fy in [(0.3, 0.3), (0.7, 0.3), (0.5, 0.5), (0.3, 0.7), (0.7, 0.7)]:
        dd.ellipse([dsz * fx - pr, dsz * fy - pr, dsz * fx + pr, dsz * fy + pr], fill=PIP + (255,))
    art.alpha_composite(die, ((A - dsz) // 2, (A - dsz) // 2))
    art = art.rotate(45, resample=Image.BICUBIC, expand=True)
    # soft shadow
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    a = art.split()[3].point(lambda v: int(v * 0.55))
    x, y = (W - art.size[0]) // 2, (W - art.size[1]) // 2
    sh.paste(Image.new('RGBA', art.size, (0, 0, 0, 255)), (x, y + int(W * 0.02)), a)
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(W * 0.02)))
    canvas.alpha_composite(art, (x, y))


def rounded_mask(size, r):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], r, fill=255)
    return m


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(root)
    res = os.path.join(repo, 'android/app/src/main/res')
    big = 2048
    full = background(big).convert('RGBA')
    draw_art(full, 0.8)
    full = full.convert('RGB').resize((S, S), Image.LANCZOS)
    full.save(os.path.join(root, 'icon-full.png'))
    for out in [os.path.join(root, 'play-store-icon-512.png'), os.path.join(repo, 'www/icon.png'), os.path.join(repo, 'store/icon-512.png')]:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        full.resize((512, 512), Image.LANCZOS).save(out)
    fg = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw_art(fg, 0.6)
    fg = fg.resize((432, 432), Image.LANCZOS)
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    fsizes = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
    for dens, px in sizes.items():
        d = os.path.join(res, 'mipmap-' + dens)
        sq = full.resize((px, px), Image.LANCZOS)
        out = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        out.paste(sq, (0, 0), rounded_mask(px, int(px * 0.18)))
        out.save(os.path.join(d, 'ic_launcher.png'))
        rnd = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        cm = Image.new('L', (px, px), 0)
        ImageDraw.Draw(cm).ellipse([0, 0, px - 1, px - 1], fill=255)
        rnd.paste(sq, (0, 0), cm)
        rnd.save(os.path.join(d, 'ic_launcher_round.png'))
        fg.resize((fsizes[dens], fsizes[dens]), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
    splash_sizes = {
        'drawable': (480, 320),
        'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
        'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
        'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
        'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
    }
    logo = Image.new('RGBA', (big, big), SPLASH + (255,))
    draw_art(logo, 0.62)
    logo = logo.convert('RGB')
    for folder, (w, h) in splash_sizes.items():
        im = Image.new('RGB', (w, h), SPLASH)
        side = int(min(w, h) * 0.5)
        im.paste(logo.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
        im.save(os.path.join(res, folder, 'splash.png'))
    print('icons + splash written')


if __name__ == '__main__':
    main()
