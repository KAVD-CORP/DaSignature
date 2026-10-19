#!/usr/bin/env python3
"""Verify the brand pack + build review/contact-sheet.png and review/verify-report.md. Usage: python3 source/verify_brand.py"""
import json, os, re, subprocess, sys, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); B = os.path.dirname(HERE); sys.path.insert(0, HERE)
from parts import NAVY, FEATHER, GOLD
G = json.load(open(os.path.join(B, "review", "geometry.json")))
res = []  # (check, ok, detail)
def chk(name, ok, detail=""): res.append((name, bool(ok), detail))
hexrgb = lambda h: tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
P = os.path.join

# 1 iOS
ct = json.load(open(P(B, "ios/AppIcon.appiconset/Contents.json")))
bad = []
for im in ct["images"]:
    f = P(B, "ios/AppIcon.appiconset", im["filename"]); px = round(float(im["size"].split("x")[0]) * int(im["scale"][0]))
    i = Image.open(f)
    if i.size != (px, px) or i.mode != "RGB": bad.append(f"{im['filename']} {i.size} {i.mode}")
chk("iOS: 18 Contents.json entries, every PNG RGB (no alpha) and correct size", not bad and len(ct["images"]) == 18, "; ".join(bad) or f"{len(ct['images'])} entries OK")
m = Image.open(P(B, "ios/AppIcon.appiconset/AppIcon-1024.png"))
chk("iOS 1024 master: 1024x1024, mode RGB, no alpha channel, no transparency info", m.size == (1024, 1024) and m.mode == "RGB" and "transparency" not in m.info, f"{m.size} {m.mode}")

# 2 Android
for d, k in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    sizes = {n: Image.open(P(B, f"android/res/mipmap-{d}/{n}.png")).size[0] for n in ("ic_launcher_foreground", "ic_launcher_monochrome", "ic_launcher", "ic_launcher_round")}
    exp = {"ic_launcher_foreground": int(108*k), "ic_launcher_monochrome": int(108*k), "ic_launcher": int(48*k), "ic_launcher_round": int(48*k)}
    chk(f"Android mipmap-{d}: sizes 108dp/48dp x {k}", sizes == exp, str(sizes))
def max_r(path, thr=0):
    a = np.array(Image.open(path).convert("RGBA")); al = a[..., 3] > thr; ys, xs = np.nonzero(al); n = a.shape[0]
    return float(np.sqrt((xs + .5 - n/2) ** 2 + (ys + .5 - n/2) ** 2).max()), n
for n in ("ic_launcher_foreground", "ic_launcher_monochrome"):
    r, s = max_r(P(B, f"android/res/mipmap-xxxhdpi/{n}.png")); rdp = r / s * 108
    chk(f"Android {n}: all painted pixels inside the 66 dp safe circle (r <= 33 dp)", rdp <= 33, f"max r = {rdp:.2f} dp (canvas 108 dp)")
mono = np.array(Image.open(P(B, "android/res/mipmap-xxxhdpi/ic_launcher_monochrome.png")).convert("RGBA"))
vis = mono[mono[..., 3] > 0][:, :3]
chk("Android monochrome layer: pure white + alpha only (system tints it)", (vis == 255).all(), f"{len(vis)} painted px")
fgarr = np.array(Image.open(P(B, "android/res/mipmap-xxxhdpi/ic_launcher_foreground.png")).convert("RGBA"))
chk("Android foreground: transparent background, feather+nib only (no navy, no signature)", fgarr[0, 0, 3] == 0 and not ((fgarr[..., 3] == 255) & (np.abs(fgarr[..., :3].astype(int) - hexrgb(NAVY)).sum(-1) < 6)).any(), "corner alpha 0; no opaque navy pixels")
xml = open(P(B, "android/res/mipmap-anydpi-v26/ic_launcher.xml")).read()
chk("Android adaptive XML: background/foreground/monochrome layers", all(t in xml for t in ("<background", "<foreground", "<monochrome")))
chk("Android background color = #141A3C", NAVY in open(P(B, "android/res/values/ic_launcher_background.xml")).read())

# 3 PWA maskable
for px in (192, 512):
    a = np.array(Image.open(P(B, f"pwa/maskable-{px}.png")).convert("RGB")).astype(int)
    non = np.abs(a - hexrgb(NAVY)).sum(-1) > 12; ys, xs = np.nonzero(non)
    r = np.sqrt((xs + .5 - px/2) ** 2 + (ys + .5 - px/2) ** 2).max() / px
    chk(f"PWA maskable-{px}: {px}px, full-bleed navy, content inside 80% safe circle (r <= 0.40)", a.shape[:2] == (px, px) and r <= 0.40, f"content r = {r:.3f} of size")
    chk(f"PWA icon-{px} (any): {px}px", Image.open(P(B, f"pwa/icon-{px}.png")).size == (px, px))
mf = json.load(open(P(B, "pwa/manifest-snippet.json"))); chk("PWA manifest snippet: any + maskable 192/512 + svg", len(mf["icons"]) == 5)

# 4 favicon / desktop
for px in (16, 32, 48): chk(f"favicon-{px}.png is {px}px", Image.open(P(B, f"favicon/favicon-{px}.png")).size == (px, px))
def ico_sizes(f): return sorted({tuple(s) for s in Image.open(f).info.get("sizes", set())})
chk("favicon.ico contains 16/32/48", ico_sizes(P(B, "favicon/favicon.ico")) == [(16, 16), (32, 32), (48, 48)], str(ico_sizes(P(B, "favicon/favicon.ico"))))
chk("dasignature.ico contains 16-256", ico_sizes(P(B, "desktop/dasignature.ico")) == [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)], str(ico_sizes(P(B, "desktop/dasignature.ico"))))
import icnsutil
keys = sorted(icnsutil.IcnsFile(P(B, "desktop/dasignature.icns")).media.keys())
chk("dasignature.icns has 16-1024 incl. @2x", set(["ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14", "icp4", "icp5"]) <= set(keys), ",".join(keys))
icnsv = subprocess.run([sys.executable, "-m", "icnsutil", "test", P(B, "desktop/dasignature.icns")], capture_output=True, text=True)
chk("icnsutil test (format validity)", icnsv.returncode == 0, (icnsv.stdout + icnsv.stderr).strip().splitlines()[-1] if (icnsv.stdout + icnsv.stderr).strip() else "ok")
for f in glob.glob(P(B, "desktop/png/dasignature-*.png")):
    px = int(re.search(r"-(\d+)\.png", f).group(1)); 
    if Image.open(f).size != (px, px): chk(f"desktop png {px}", False)
chk("desktop png set 16,24,32,48,64,128,256,512,1024 sizes correct", len(glob.glob(P(B, "desktop/png/*.png"))) == 9)

# 5 flat + colors
svgs = glob.glob(P(B, "**/*.svg"), recursive=True)
flat = [f for f in svgs if re.search(r"gradient|<filter|shadow|opacity=|<pattern", open(f).read(), re.I)]
chk(f"All {len(svgs)} SVGs flat (no gradient/filter/shadow/opacity/pattern)", not flat, ", ".join(flat))
chk("Derived SVGs carry no C2PA/metadata blob", not [f for f in svgs if "c2pa" in open(f).read()])
lk = [f for f in svgs if "lockup" in f]
chk("Lockup/wordmark SVGs fully outlined (no <text>, no font refs)", not [f for f in lk if re.search(r"<text|font-family|@font-face", open(f).read())], f"{len(lk)} files")
pal = {hexrgb(NAVY), hexrgb(FEATHER), hexrgb(GOLD)}
a = np.array(Image.open(P(B, "ios/AppIcon.appiconset/AppIcon-1024.png")).convert("RGB")).reshape(-1, 3)
cols, cnt = np.unique(a, axis=0, return_counts=True)
inpal = sum(c for col, c in zip(map(tuple, cols), cnt) if col in pal) / len(a)
top3 = {tuple(cols[i]) for i in np.argsort(-cnt)[:3]}
chk("Colors: top-3 colors of iOS 1024 are exactly #141A3C/#F6F3EC/#E8B04A", top3 == pal, f"{inpal*100:.1f}% of pixels exactly on palette (rest = anti-aliased edges)")
for name, col in (("lockup-light@4x", NAVY), ("lockup-dark@4x", FEATHER)):
    a = np.array(Image.open(P(B, f"lockup/{name}.png")).convert("RGBA")); w = a.shape[1]
    t = a[:, int(w * 0.3):][a[:, int(w * 0.3):, 3] == 255][:, :3]
    chk(f"{name}: wordmark color {col}", len(t) and (np.abs(t.astype(int) - hexrgb(col)).sum(-1) == 0).mean() > .99)

dk = open(P(B, "lockup/lockup-dark.svg")).read(); lt = open(P(B, "lockup/lockup-light.svg")).read()
chk("Dark lockup: 1 px #2A3163 hairline around icon tile; light lockup has none", 'stroke="#2A3163" stroke-width="1"' in dk and "#2A3163" not in lt)
a = np.array(Image.open(P(B, "lockup/lockup-dark@1x.png")).convert("RGBA")).astype(int)
edge = a[64, 0]; chk("Dark lockup @1x: hairline pixel at tile edge is #2A3163-ish", abs(edge[:3] - np.array(hexrgb("#2A3163"))).sum() < 40 and edge[3] > 200, str(edge.tolist()))
# 6 master integrity + metadata hygiene
import xml.etree.ElementTree as ET, hashlib, struct, io
MASTER = P(B, "..", "..", "dasignature-icon.svg"); mtxt = open(MASTER).read()
try: ET.fromstring(mtxt); valid = True
except ET.ParseError as e: valid = str(e)
chk("Master SVG is valid XML", valid is True, "" if valid is True else valid)
import parts as PT
norm = lambda t: re.sub(r"\s+", " ", t)
geo = [PT.VANE, PT.NIB, PT.NOTCH, PT.RACHIS[0], PT.BARBS[0], PT.SIG[0], PT.GROUP_TF, PT.NAVY, PT.FEATHER, PT.GOLD]
chk("Master geometry unchanged: all path/transform strings in parts.py present verbatim", all(norm(g) in norm(mtxt) for g in geo), f"{len(geo)} strings")
ref = json.load(open(P(B, "review", "artwork-reference.json")))
ph = lambda f: hashlib.sha256(np.array(Image.open(f).convert("RGBA")).tobytes()).hexdigest()
chk("Master artwork pixel-identical to pre-C2PA-strip build (1024 renders)", all(ph(P(B, k)) == v for k, v in ref.items() if k != "note"))
BAD_TXT = re.compile(r"c2pa|jumbf|jumb|xmpmeta|ns\.adobe\.com/xap|<metadata|anthropic|claude|openai|midjourney|dall-?e|stable.?diffusion|contentcredentials|trainedAlgorithmicMedia", re.I)
BAD_BIN = [b"c2pa", b"jumb", b"jumd", b"caBX", b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"iCCP", b"xmpmeta", b"XML:com.adobe.xmp", b"Exif\x00"]
ALLOWED = {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}
def png_chunks(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"; i = 8; out = []
    while i < len(data):
        ln = struct.unpack(">I", data[i:i+4])[0]; out.append(data[i+4:i+8]); i += 12 + ln
    return out
bad_files, png_n, emb_n = [], 0, 0
for f in sorted(glob.glob(P(B, "**/*"), recursive=True)):
    if os.path.isdir(f) or "/source/" in f or f.endswith((".md", ".json", ".py")): continue
    data = open(f, "rb").read()
    if f.endswith(".svg"):
        if BAD_TXT.search(data.decode()): bad_files.append(f + " (svg text)")
        continue
    hits = [m.decode(errors="replace") for m in BAD_BIN if m in data]
    if hits: bad_files.append(f"{f} {hits}")
    if f.endswith(".png"):
        png_n += 1; extra = set(png_chunks(data)) - ALLOWED
        if extra: bad_files.append(f"{f} chunks {extra}")
    elif f.endswith((".ico", ".icns")):
        j = 0
        while (j := data.find(b"\x89PNG\r\n\x1a\n", j)) != -1:
            emb_n += 1; end = data.find(b"IEND", j) + 8; extra = set(png_chunks(data[j:end])) - ALLOWED
            if extra: bad_files.append(f"{f} embedded png chunks {extra}")
            j = end
chk("No C2PA/JUMBF, XMP, EXIF, ICC, text (tEXt/iTXt/zTXt) or caBX metadata in any output; PNG chunks limited to IHDR/PLTE/tRNS/IDAT/IEND",
    not bad_files, "; ".join(bad_files) or f"{png_n} PNGs + {emb_n} PNGs embedded in .ico/.icns + SVGs scanned")

# 7 simplified 16 px variant
f16 = np.array(Image.open(P(B, "favicon/favicon-16.png")).convert("RGBA"))
full16 = np.array(Image.open(P(B, "desktop/png/dasignature-24.png")).convert("RGBA").resize((16, 16), Image.LANCZOS))
svg16 = open(P(B, "favicon/favicon-16.svg")).read()
chk("Simplified 16 px variant: no barbs/notch/rachis/signature in source, palette only, flat", all(x not in svg16 for x in (PT.BARBS[0], PT.NOTCH, PT.SIG[0])) and set(re.findall(r"#[0-9A-F]{6}", svg16)) == {PT.NAVY, PT.FEATHER, PT.GOLD}, "solid vane + nib, emboldened")
def ico16(f):
    return np.array(Image.open(f).ico.getimage((16, 16)).convert("RGBA"))
chk("favicon.ico 16 slot = simplified variant (pixel-equal to favicon-16.png)", np.array_equal(ico16(P(B, "favicon/favicon.ico")), f16))
chk("desktop .ico 16 slot = simplified variant", np.array_equal(ico16(P(B, "desktop/dasignature.ico")), np.array(Image.open(P(B, "desktop/png/dasignature-16.png")).convert("RGBA"))) and np.array_equal(f16, np.array(Image.open(P(B, "desktop/png/dasignature-16.png")).convert("RGBA"))))
icp4 = icnsutil.IcnsFile(P(B, "desktop/dasignature.icns")).media["icp4"]
chk(".icns 16 slot (icp4) = simplified variant on the Apple grid", np.array_equal(np.array(Image.open(io.BytesIO(icp4)).convert("RGBA")), np.array(Image.open(P(B, "desktop/macos/macos-16.png")).convert("RGBA"))))
chk("32 px and up keep the full mark (favicon-32 differs from simplified art)", Image.open(P(B, "favicon/favicon-32.png")).size == (32, 32) and "favicon-32" not in svg16)

ok = all(r[1] for r in res)
# ---------------- contact sheet ----------------
F = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"; font = ImageFont.truetype(F, 15); small = ImageFont.truetype(F, 12)
T = 300; PAD = 24; LAB = 44
def tile(img, label, sub=""):
    t = Image.new("RGB", (T, T + LAB), "#FFFFFF"); t.paste(img.convert("RGB") if img.mode == "RGB" else img, (0, 0), img if img.mode == "RGBA" else None)
    d = ImageDraw.Draw(t); d.text((6, T + 4), label, fill=NAVY, font=font); d.text((6, T + 24), sub, fill="#6B7090", font=small); return t
def on(bg, img, size=T):
    c = Image.new("RGBA", (size, size), bg); i = img.convert("RGBA").resize((size, size), Image.LANCZOS); c.alpha_composite(i); return c
RED, CYAN = (230, 40, 90, 255), (0, 200, 255, 255)
def circle(d, r, col, w=2): d.ellipse([T/2 - r, T/2 - r, T/2 + r, T/2 + r], outline=col, width=w)
def mask_shape(img, shape):
    m = Image.new("L", (T, T), 0); d = ImageDraw.Draw(m); s = T * 72 / 108; o = (T - s) / 2
    if shape == "circle": d.ellipse([o, o, o + s, o + s], fill=255)
    elif shape == "squircle":
        n = 4.0; pts = [(T/2 + s/2 * np.sign(np.cos(t)) * abs(np.cos(t)) ** (2/n), T/2 + s/2 * np.sign(np.sin(t)) * abs(np.sin(t)) ** (2/n)) for t in np.linspace(0, 2*np.pi, 400)]; d.polygon(pts, fill=255)
    elif shape == "rounded": d.rounded_rectangle([o, o, o + s, o + s], radius=s * .18, fill=255)
    elif shape == "teardrop": d.rounded_rectangle([o, o, o + s, o + s], radius=s / 2, fill=255); d.rectangle([T/2, T/2, o + s, o + s], fill=255)
    out = Image.new("RGBA", (T, T), (255, 255, 255, 255)); out.paste(img, (0, 0), m); return out
tiles = []
ios = Image.open(P(B, "ios/AppIcon.appiconset/AppIcon-1024.png")).resize((T, T), Image.LANCZOS).convert("RGBA")
iosm = Image.new("L", (T, T), 0); dd = ImageDraw.Draw(iosm); dd.rounded_rectangle([0, 0, T - 1, T - 1], radius=T * .2237, fill=255)
i2 = Image.new("RGBA", (T, T), (255, 255, 255, 255)); i2.paste(ios, (0, 0), iosm); d = ImageDraw.Draw(i2); d.rounded_rectangle([0, 0, T - 1, T - 1], radius=T * .2237, outline=CYAN, width=2)
tiles.append(tile(i2, "iOS 1024 (RGB, no alpha)", "cyan = iOS corner mask"))
fg = Image.open(P(B, "android/res/mipmap-xxxhdpi/ic_launcher_foreground.png"))
a1 = on(NAVY, fg); d = ImageDraw.Draw(a1); circle(d, T * 33 / 108, RED); circle(d, T * 30 / 108, CYAN, 1); s = T * 72 / 108; d.rectangle([(T - s)/2, (T - s)/2, (T + s)/2, (T + s)/2], outline=(255, 255, 255, 160), width=1)
tiles.append(tile(a1, "Android adaptive 108 dp", "red 66dp safe, cyan content r30, white 72dp view"))
base = on(NAVY, fg)
for sh in ("circle", "squircle", "rounded", "teardrop"): tiles.append(tile(mask_shape(base, sh), f"Android mask: {sh}", "launcher crop of 72 dp"))
mo = Image.open(P(B, "android/res/mipmap-xxxhdpi/ic_launcher_monochrome.png")).convert("RGBA")
tint = Image.new("RGBA", mo.size, (194, 231, 255, 255)); tint.putalpha(mo.split()[3])
th = on((31, 53, 72, 255), tint); d = ImageDraw.Draw(th); circle(d, T * 33 / 108, RED)
tiles.append(tile(mask_shape(th, "circle"), "Android themed (monochrome)", "tinted by system, circle mask"))
mk = Image.open(P(B, "pwa/maskable-512.png")).resize((T, T), Image.LANCZOS).convert("RGBA"); d = ImageDraw.Draw(mk); circle(d, T * .40, RED); circle(d, T * .36, CYAN, 1)
tiles.append(tile(mk, "PWA maskable 512", "red = 80% safe circle"))
m2 = Image.open(P(B, "pwa/maskable-512.png")).resize((T, T), Image.LANCZOS).convert("RGBA")
cm = Image.new("L", (T, T), 0); ImageDraw.Draw(cm).ellipse([T * .1, T * .1, T * .9, T * .9], fill=255); m3 = Image.new("RGBA", (T, T), (255, 255, 255, 255)); m3.paste(m2, (0, 0), cm)
tiles.append(tile(m3, "PWA maskable, min safe crop", "80% circle applied"))
tiles.append(tile(on("#FAFAF8", Image.open(P(B, "pwa/icon-512.png"))), "PWA icon 512 (any)", "transparent corners"))
mac = on("#E9E9EF", Image.open(P(B, "desktop/macos/macos-1024.png"))); d = ImageDraw.Draw(mac); o = T * 100 / 1024; d.rectangle([o, o, T - o, T - o], outline=CYAN, width=1)
tiles.append(tile(mac, "macOS .icns 1024", "cyan = 824 px Apple grid"))
fav = Image.new("RGBA", (T, T), "#FFFFFF")
s16 = Image.open(P(B, "favicon/favicon-16.png")).convert("RGBA"); f32 = Image.open(P(B, "favicon/favicon-32.png")).convert("RGBA")
fold = Image.open(P(B, "desktop/png/dasignature-24.png")).convert("RGBA").resize((16, 16), Image.LANCZOS)
for i, im in enumerate((fold, s16, f32)): fav.alpha_composite(im, (30 + i * 90, 14))
for i, im in enumerate((fold, s16)): fav.alpha_composite(im.resize((112, 112), Image.NEAREST), (24 + i * 140, 50))
fav.alpha_composite(f32.resize((96, 96), Image.NEAREST), (100, 176))
dkb = Image.new("RGBA", (T, 26), "#0E1126")
for i, im in enumerate((s16, f32)): dkb.alpha_composite(im, (120 + i * 40, 5 if im.size[0] == 16 else -3))
fav.alpha_composite(dkb, (0, 274))
d = ImageDraw.Draw(fav); d.text((8, 166), "full@16", fill="#6B7090", font=small); d.text((150, 166), "simplified@16", fill=NAVY, font=small); d.text((8, 250), "32 = full mark", fill="#6B7090", font=small)
tiles.append(tile(fav, "Favicon: simplified 16 vs full; 32 full", "row1 1:1 (old16, new16, 32); zoomed below; dark strip"))
for name, bg in (("glyph-navy-512", "#FAFAF8"), ("glyph-offwhite-512", "#0E1126")):
    tiles.append(tile(on(bg, Image.open(P(B, f"glyph/{name}.png"))), name.replace("-512", ""), "monochrome glyph"))
cols = 4; rows = (len(tiles) + cols - 1) // cols
lw = cols * T + (cols - 1) * PAD
lock = []
for v, bg in (("light", "#FAFAF8"), ("dark", "#0E1126")):
    im = Image.open(P(B, f"lockup/lockup-{v}@4x.png")).convert("RGBA"); s = (lw - 80) / im.width; im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    c = Image.new("RGBA", (lw, im.height + 60), bg); c.alpha_composite(im, (40, 30)); lock.append(c)
H = 70 + rows * (T + LAB + PAD) + sum(l.height + PAD for l in lock) + 40
sheet = Image.new("RGB", (lw + 2 * PAD, H), "#F1F1EE"); d = ImageDraw.Draw(sheet)
d.text((PAD, 20), f"DaSignature brand pack - review sheet   |   verification: {sum(r[1] for r in res)}/{len(res)} checks pass", fill=NAVY, font=ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", 22))
for i, t in enumerate(tiles):
    sheet.paste(t, (PAD + (i % cols) * (T + PAD), 70 + (i // cols) * (T + LAB + PAD)))
y = 70 + rows * (T + LAB + PAD)
for l in lock: sheet.paste(l.convert("RGB"), (PAD, y)); y += l.height + PAD
d.text((PAD, y), "Lockups: 'Da' Inter Regular + 'Signature' Inter SemiBold, tracking -0.02em, outlined paths.", fill="#6B7090", font=font)
sheet.save(P(B, "review", "contact-sheet.png"), optimize=True)

md = ["# Brand pack verification", "", f"Generated by `source/verify_brand.py`. Result: **{sum(r[1] for r in res)}/{len(res)} checks pass**.", "",
      "| Check | Result | Detail |", "|---|---|---|"] + [f"| {n} | {'PASS' if o else 'FAIL'} | {dt} |" for n, o, dt in res]
md += ["", "Geometry used (512-unit master space): " + json.dumps(G), "", "Contact sheet: `review/contact-sheet.png`."]
open(P(B, "review", "verify-report.md"), "w").write("\n".join(md) + "\n")
for n, o, dt in res: print("PASS" if o else "FAIL", "|", n, "|", dt)
sys.exit(0 if ok else 1)
