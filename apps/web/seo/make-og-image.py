#!/usr/bin/env python3
"""Builds og-image.png (1200x630) for the guide pages from the brand pack (decisions.md E-109).

Run from the repo root: python3 apps/web/seo/make-og-image.py   (needs Pillow). The PNG is
committed; the build only copies it. Uses lockup-dark (for dark surfaces) on brand navy, with the
brand's Inter fonts (assets/logo/source/fonts, OFL) for the tagline.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
LOGO = ROOT / 'assets/logo'
OUT = Path(__file__).resolve().parent / 'og-image.png'
W, H = 1200, 630
NAVY, FEATHER, MUTED, GOLD = '#141A3C', '#F6F3EC', '#A3A8C8', '#E8B04A'

img = Image.new('RGB', (W, H), NAVY)
lockup = Image.open(LOGO / 'lockup/lockup-dark@4x.png').convert('RGBA')
lh = 150
lockup = lockup.resize((round(lockup.width * lh / lockup.height), lh), Image.LANCZOS)
img.paste(lockup, ((W - lockup.width) // 2, 150), lockup)

draw = ImageDraw.Draw(img)
fonts = LOGO / 'source/fonts'
title = ImageFont.truetype(str(fonts / 'Inter-SemiBold.otf'), 54)
sub = ImageFont.truetype(str(fonts / 'Inter-Regular.otf'), 32)


def centered(y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)


centered(355, 'Sign PDFs privately, for free', title, FEATHER)
centered(435, 'Your files never leave your device. Open source. Works offline.', sub, MUTED)
draw.rectangle([(W - 120) // 2, 520, (W + 120) // 2, 526], fill=GOLD)
img.save(OUT, optimize=True)
print(OUT, img.size)
