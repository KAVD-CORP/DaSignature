#!/usr/bin/env python3
"""Build the DaSignature brand asset pack from the master logo (SPEC Sec 11).
Requires: rsvg-convert (librsvg2-bin), Python: Pillow, numpy, uharfbuzz, fontTools, icnsutil.
Usage: python3 source/build_brand.py   (run from design/brand/). Deterministic; safe to re-run."""
import json, math, os, re, shutil, subprocess, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from parts import *
OUT = os.path.dirname(HERE)
MASTER = os.path.join(OUT, "..", "..", "dasignature-icon.svg")
TMP = "/tmp/dasig-brand"; os.makedirs(TMP, exist_ok=True)

def mk(*p):
    d = os.path.join(OUT, *p); os.makedirs(d, exist_ok=True); return d

def svg(body, w=512, h=512, vb=None, title="DaSignature"):
    vb = vb or f"0 0 {w} {h}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')

def render(svg_text, path, w, h=None, flatten=None):
    """Render SVG text to PNG. flatten='#RRGGBB' removes alpha (RGB output)."""
    h = h or w; src = os.path.join(TMP, "r.svg"); open(src, "w").write(svg_text)
    subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h), src, "-o", path], check=True)
    im = Image.open(path).convert("RGBA")
    if flatten:
        out = Image.new("RGB", im.size, flatten); out.paste(im, mask=im.split()[3])
    else:
        out = Image.new("RGBA", im.size); out.paste(im)
    # fresh Image => empty .info: no tEXt/iTXt/zTXt/eXIf/iCCP/caBX or other metadata chunks are written
    out.save(path, format="PNG", optimize=True)

def write(path, text): open(path, "w").write(text)

# ---------------- master (clean) ----------------
raw = open(MASTER).read()
assert not re.search(r"gradient|filter|<pattern|opacity=|shadow", raw, re.I), "master not flat"
master_clean = re.sub(r"<metadata>.*?</metadata>", "", raw, flags=re.S)
master_clean = re.sub(r"\s*xmlns:c2pa=\"[^\"]+\"", "", master_clean)
md = mk("master")
write(os.path.join(md, "dasignature-icon.svg"), master_clean)                 # rounded square (rx 112), transparent corners
FULL = master_clean.replace('rx="112" ', "")                                   # full-bleed square for platform masks
write(os.path.join(md, "dasignature-icon-fullbleed.svg"), FULL)
render(master_clean, os.path.join(md, "dasignature-icon-1024.png"), 1024)
render(FULL, os.path.join(md, "dasignature-icon-fullbleed-1024.png"), 1024, flatten=NAVY)

# ---------------- geometry: minimal enclosing circle of a part, in 512 space ----------------
def mec(body):
    p = os.path.join(TMP, "g.png"); render(svg(body), p, 2048)
    a = np.array(Image.open(p))[..., 3] > 8; ys, xs = np.nonzero(a); pts = np.stack([xs, ys], 1) / 4.0
    pts = pts[::max(1, len(pts) // 20000)]
    c = pts.mean(0); step = 32.0
    best = np.sqrt(((pts - c) ** 2).sum(1)).max()
    while step > 0.05:
        moved = False
        for dx, dy in ((step, 0), (-step, 0), (0, step), (0, -step)):
            cc = c + (dx, dy); r = np.sqrt(((pts - cc) ** 2).sum(1)).max()
            if r < best: best, c, moved = r, cc, True
        if not moved: step /= 2
    return float(c[0]), float(c[1]), float(best)

Q_CUT = lambda color=None, mid="q": quill("cutout", mono=color, mid=mid)
qx, qy, qr = mec(Q_CUT("#000"))
fx, fy, fr = mec(Q_CUT("#000") + signature("#000"))
GEOM = {"quill_mec": [round(qx, 2), round(qy, 2), round(qr, 2)], "full_mark_mec": [round(fx, 2), round(fy, 2), round(fr, 2)]}

def placed(body, cx, cy, r, size, target_r):
    """Transform 512-space body so its enclosing circle (cx,cy,r) maps to radius target_r at canvas center."""
    s = target_r / r
    return f'<g transform="translate({size/2} {size/2}) scale({s:.6f}) translate({-cx:.4f} {-cy:.4f})">{body}</g>'

# ---------------- iOS ----------------
ios = mk("ios", "AppIcon.appiconset")
IOS = [("iphone", "20x20", "2x", 40), ("iphone", "20x20", "3x", 60), ("iphone", "29x29", "2x", 58), ("iphone", "29x29", "3x", 87),
       ("iphone", "40x40", "2x", 80), ("iphone", "40x40", "3x", 120), ("iphone", "60x60", "2x", 120), ("iphone", "60x60", "3x", 180),
       ("ipad", "20x20", "1x", 20), ("ipad", "20x20", "2x", 40), ("ipad", "29x29", "1x", 29), ("ipad", "29x29", "2x", 58),
       ("ipad", "40x40", "1x", 40), ("ipad", "40x40", "2x", 80), ("ipad", "76x76", "1x", 76), ("ipad", "76x76", "2x", 152),
       ("ipad", "83.5x83.5", "2x", 167), ("ios-marketing", "1024x1024", "1x", 1024)]
images = []
for idiom, sz, sc, px in IOS:
    fn = f"AppIcon-{px}.png"
    if not os.path.exists(os.path.join(ios, fn)): render(FULL, os.path.join(ios, fn), px, flatten=NAVY)
    images.append({"filename": fn, "idiom": idiom, "scale": sc, "size": sz})
write(os.path.join(ios, "Contents.json"), json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
# also write AppIcon-1024 under a clear name for Xcode single-size mode
shutil.copy(os.path.join(ios, "AppIcon-1024.png"), os.path.join(mk("ios"), "AppIcon-1024-master.png"))

# ---------------- Android adaptive ----------------
AND_CANVAS, AND_SAFE_R, AND_CONTENT_R = 108.0, 33.0, 30.0   # dp; content kept inside r=30 (< 33 safe circle)
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
fg_body = placed(Q_CUT(mid="fg"), qx, qy, qr, AND_CANVAS, AND_CONTENT_R)
mono_body = placed(Q_CUT("#FFFFFF", mid="mo"), qx, qy, qr, AND_CANVAS, AND_CONTENT_R)
FG_SVG = svg(fg_body, 108, 108); MONO_SVG = svg(mono_body, 108, 108)
ares = mk("android", "res")
write(os.path.join(mk("android", "source"), "ic_launcher_foreground.svg"), FG_SVG)
write(os.path.join(mk("android", "source"), "ic_launcher_monochrome.svg"), MONO_SVG)
# legacy (pre-API 26) icons: square (rounded, from master) and round
ROUND_SVG = svg(f'<circle cx="256" cy="256" r="256" fill="{NAVY}"/>' + placed(quill("color") + signature(), fx, fy, fr, 512, 256 * 0.80), 512, 512)
for d, m in DENS.items():
    mm = mk("android", "res", f"mipmap-{d}")
    render(FG_SVG, os.path.join(mm, "ic_launcher_foreground.png"), int(108 * m))
    render(MONO_SVG, os.path.join(mm, "ic_launcher_monochrome.png"), int(108 * m))
    render(master_clean, os.path.join(mm, "ic_launcher.png"), int(48 * m))
    render(ROUND_SVG, os.path.join(mm, "ic_launcher_round.png"), int(48 * m))
ADAPT = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
         '    <background android:drawable="@color/ic_launcher_background" />\n'
         '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
         '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n')
any26 = mk("android", "res", "mipmap-anydpi-v26")
write(os.path.join(any26, "ic_launcher.xml"), ADAPT); write(os.path.join(any26, "ic_launcher_round.xml"), ADAPT)
write(os.path.join(mk("android", "res", "values"), "ic_launcher_background.xml"),
      f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{NAVY}</color>\n</resources>\n')
render(FULL, os.path.join(mk("android"), "play-store-512.png"), 512, flatten=NAVY)

# ---------------- Monochrome glyph ----------------
gd = mk("glyph")
GLYPH = lambda col, mid: placed(Q_CUT(col, mid) + signature(col), fx, fy, fr, 512, 248)
write(os.path.join(gd, "glyph.svg"), svg(GLYPH("currentColor", "g"), title="DaSignature glyph").replace("<svg ", '<svg fill="currentColor" ', 1))
for name, col in (("glyph-navy", NAVY), ("glyph-offwhite", FEATHER), ("glyph-white", "#FFFFFF"), ("glyph-black", "#000000")):
    s = svg(GLYPH(col, "g"), title="DaSignature glyph"); write(os.path.join(gd, name + ".svg"), s)
    for px in (512, 1024): render(s, os.path.join(gd, f"{name}-{px}.png"), px)

# ---------------- PWA ----------------
pd = mk("pwa")
MASK_R = 0.40; MASK_CONTENT_R = 0.36   # W3C maskable safe zone: circle r = 40% of size; content kept in 36%
MASKABLE = svg(f'<rect width="512" height="512" fill="{NAVY}"/>' + placed(quill("color") + signature(), fx, fy, fr, 512, 512 * MASK_CONTENT_R))
write(os.path.join(pd, "maskable.svg"), MASKABLE)
for px in (192, 512):
    render(MASKABLE, os.path.join(pd, f"maskable-{px}.png"), px, flatten=NAVY)
    render(master_clean, os.path.join(pd, f"icon-{px}.png"), px)
render(FULL, os.path.join(pd, "apple-touch-icon-180.png"), 180, flatten=NAVY)
write(os.path.join(pd, "manifest-snippet.json"), json.dumps({
  "name": "DaSignature", "short_name": "DaSignature", "theme_color": NAVY, "background_color": "#FAFAF8", "display": "standalone",
  "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            {"src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}]}, indent=2) + "\n")

# ---------------- Favicon ----------------
fd = mk("favicon")
write(os.path.join(fd, "favicon.svg"), master_clean)
SIMPLE16_SVG = svg(f'<rect width="512" height="512" rx="{MASTER_RX}" fill="{NAVY}"/>' + quill_simple(qx, qy, qr), title="DaSignature")
write(os.path.join(fd, "favicon-16.svg"), SIMPLE16_SVG)          # source of the 16 px variant (do not use above 16 px)
render(SIMPLE16_SVG, os.path.join(fd, "favicon-16.png"), 16)
for px in (32, 48): render(master_clean, os.path.join(fd, f"favicon-{px}.png"), px)

def save_ico(path, pngs):
    """Pillow ICO with a distinct source image per size (no metadata chunks)."""
    ims = [Image.open(p).convert("RGBA") for p in pngs]; big = max(ims, key=lambda i: i.size[0])
    big.save(path, format="ICO", sizes=[i.size for i in ims], append_images=[i for i in ims if i is not big])
save_ico(os.path.join(fd, "favicon.ico"), [os.path.join(fd, f"favicon-{p}.png") for p in (16, 32, 48)])

# ---------------- Desktop ----------------
dd = mk("desktop"); dp = mk("desktop", "png")
render(SIMPLE16_SVG, os.path.join(dp, "dasignature-16.png"), 16)   # 16 px slot = simplified variant
for px in (24, 32, 48, 64, 128, 256, 512, 1024): render(master_clean, os.path.join(dp, f"dasignature-{px}.png"), px)
save_ico(os.path.join(dd, "dasignature.ico"), [os.path.join(dp, f"dasignature-{p}.png") for p in (16, 24, 32, 48, 64, 128, 256)])
# macOS: Apple icon grid - 824 px body centered in 1024 canvas, transparent margin
MAC = svg(f'<g transform="translate(100 100) scale({824/512})">' + re.sub(r"^.*?<title>DaSignature</title>", "", master_clean, flags=re.S).replace("</svg>", "") + "</g>", 1024, 1024)
write(os.path.join(mk("desktop", "macos"), "dasignature-macos.svg"), MAC)
icns_src = {}
MAC16 = svg(f'<g transform="translate(100 100) scale({824/512})"><rect width="512" height="512" rx="{MASTER_RX}" fill="{NAVY}"/>{quill_simple(qx, qy, qr)}</g>', 1024, 1024)
for px in (16, 32, 64, 128, 256, 512, 1024):
    p = os.path.join(mk("desktop", "macos"), f"macos-{px}.png"); render(MAC16 if px == 16 else MAC, p, px); icns_src[px] = p
import icnsutil
img = icnsutil.IcnsFile()
for key, px in (("icp4", 16), ("icp5", 32), ("ic11", 32), ("ic12", 64), ("ic07", 128), ("ic13", 256), ("ic08", 256), ("ic14", 512), ("ic09", 512), ("ic10", 1024)):
    img.add_media(key, file=icns_src[px])
img.write(os.path.join(dd, "dasignature.icns"))
shutil.copy(os.path.join(dp, "dasignature-512.png"), os.path.join(dd, "dasignature.png"))  # Linux / Tauri icon.png

# ---------------- Lockup (outlined Inter) ----------------
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
FONTS = os.path.join(HERE, "fonts")
TRACK = -0.02  # em, tokens: --tracking-wordmark
def run_paths(text, font_file, size, x0, baseline):
    data = open(font_file, "rb").read(); face = hb.Face(data); font = hb.Font(face); upm = face.upem
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties(); hb.shape(font, buf, {"kern": True, "liga": True})
    tt = TTFont(font_file); gs = tt.getGlyphSet(); order = tt.getGlyphOrder(); s = size / upm; x = x0; d = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(gs); tp = TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, baseline - pos.y_offset * s))
        gs[order[info.codepoint]].draw(tp); d.append(pen.getCommands())
        x += pos.x_advance * s + TRACK * size
    cap = tt["OS/2"].sCapHeight * s
    return " ".join(d), x, cap
H = 128.0; FS = 70.0; GAP = 0.25 * H
reg, semi = os.path.join(FONTS, "Inter-Regular.otf"), os.path.join(FONTS, "Inter-SemiBold.otf")
_, _, cap = run_paths("D", reg, FS, 0, 0)
BASE = H / 2 + cap / 2
d1, x1, _ = run_paths("Da", reg, FS, H + GAP, BASE)
d2, x2, _ = run_paths("Signature", semi, FS, x1, BASE)
W = math.ceil(x2 - TRACK * FS + 2)
icon_inner = re.sub(r"^.*?<title>DaSignature</title>", "", master_clean, flags=re.S).replace("</svg>", "")
ld = mk("lockup")
for variant, col in (("light", NAVY), ("dark", FEATHER)):
    # PM-approved: dark lockup only gets a 1 px hairline in dark --border (#2A3163) around the icon tile (inset 0.5 px)
    hair = (f'<rect x="0.5" y="0.5" width="{H-1}" height="{H-1}" rx="{MASTER_RX*H/512 - 0.5}" fill="none" stroke="#2A3163" stroke-width="1"/>'
            if variant == "dark" else "")
    body = (f'<g transform="scale({H/512})">{icon_inner}</g>{hair}'
            f'<path d="{d1}" fill="{col}"/><path d="{d2}" fill="{col}"/>')
    s = svg(body, W, int(H), title="DaSignature")
    write(os.path.join(ld, f"lockup-{variant}.svg"), s)
    for k in (1, 2, 4): render(s, os.path.join(ld, f"lockup-{variant}@{k}x.png"), W * k, int(H) * k)
    write(os.path.join(ld, f"wordmark-{variant}.svg"),
          svg(f'<g transform="translate({-(H + GAP)} 0)"><path d="{d1}" fill="{col}"/><path d="{d2}" fill="{col}"/></g>', int(W - H - GAP), int(H), title="DaSignature"))
GEOM.update({"lockup": {"height": H, "font_size": FS, "gap": GAP, "width": W, "tracking_em": TRACK, "cap_height": round(cap, 2)},
             "android": {"canvas_dp": AND_CANVAS, "safe_r_dp": AND_SAFE_R, "content_r_dp": AND_CONTENT_R},
             "maskable": {"safe_r": MASK_R, "content_r": MASK_CONTENT_R}})
write(os.path.join(mk("review"), "geometry.json"), json.dumps(GEOM, indent=2) + "\n")
print("built", json.dumps(GEOM))
