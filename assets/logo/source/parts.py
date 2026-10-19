"""Logo parts lifted VERBATIM from the master dasignature-icon.svg (512x512 space). Do not edit geometry."""
NAVY, FEATHER, GOLD = "#141A3C", "#F6F3EC", "#E8B04A"
GROUP_TF = "translate(256 256) rotate(34) scale(0.9) translate(-256 -256)"
VANE = "M268 6 C346 70 352 196 270 302 L256 310 L244 302 C190 236 186 100 268 6 Z"
NIB = "M222 300 H290 C290 340 282 372 266 398 L256 418 L246 398 C230 372 222 340 222 300 Z"
# navy detail marks (in the master they are painted navy; here they become cut-outs)
NOTCH = "M338 128 L292 150 L336 154 Z"
RACHIS = ("M262 30 Q256 170 256 304", 5)
BARBS = ("M257 262 L318 226 M257 222 L330 186 M257 182 L324 132 M257 142 L316 98 M257 102 L296 62 "
         "M257 262 L206 232 M257 222 L200 184 M257 182 L204 130 M257 142 L216 86", 4)
NIB_HOLE = (256, 334, 8)
NIB_SLIT = ("M256 342 L256 414", 4)
SIG = ("M150 428 C196 446 236 408 282 424 S350 430 372 416", 7)
MASTER_RX = 112

def _details(color="black"):
    return (f'<path d="{NOTCH}" fill="{color}"/>'
            f'<path d="{RACHIS[0]}" stroke="{color}" stroke-width="{RACHIS[1]}" stroke-linecap="round" fill="none"/>'
            f'<path d="{BARBS[0]}" stroke="{color}" stroke-width="{BARBS[1]}" stroke-linecap="round" fill="none"/>'
            f'<circle cx="{NIB_HOLE[0]}" cy="{NIB_HOLE[1]}" r="{NIB_HOLE[2]}" fill="{color}"/>'
            f'<path d="{NIB_SLIT[0]}" stroke="{color}" stroke-width="{NIB_SLIT[1]}" stroke-linecap="round"/>')

def quill(mode="color", mono=None, mid="q"):
    """Feather + nib in 512-space.
    mode 'color': painted exactly like the master (navy details drawn on top) - for use on a navy field.
    mode 'cutout': details are true holes (mask) - for transparent foregrounds and monochrome.
    mono: single fill color for monochrome."""
    vf, nf = (mono, mono) if mono else (FEATHER, GOLD)
    if mode == "color":
        return f'<g transform="{GROUP_TF}"><path d="{VANE}" fill="{vf}"/>{_details(NAVY).split("<circle")[0]}<path d="{NIB}" fill="{nf}"/><circle{_details(NAVY).split("<circle")[1]}</g>'
    mask = (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="-512" y="-512" width="1536" height="1536">'
            f'<g transform="{GROUP_TF}"><path d="{VANE}" fill="white"/>{_details("black").split("<circle")[0]}'
            f'<path d="{NIB}" fill="white"/><circle{_details("black").split("<circle")[1]}</g></mask>')
    return (f'<defs>{mask}</defs><g mask="url(#{mid})"><g transform="{GROUP_TF}">'
            f'<path d="{VANE}" fill="{vf}"/><path d="{NIB}" fill="{nf}"/></g></g>')

def signature(color=GOLD):
    return f'<path d="{SIG[0]}" stroke="{color}" stroke-width="{SIG[1]}" stroke-linecap="round" fill="none"/>'

# ---- Owner-approved simplified 16 px variant (legibility). Same palette, flat. ----
# Solid vane + solid nib from the master outlines, emboldened by a same-color stroke; no barbs/notch/rachis/nib slit;
# signature stroke omitted (sub-pixel at 16 px). Scaled so the quill's enclosing circle has r=232 of 256.
SIMPLE16 = dict(content_r=232, bold=30)
def quill_simple(cx, cy, r, size=512):
    s = SIMPLE16["content_r"] / r * (size / 512); b = SIMPLE16["bold"]
    return (f'<g transform="translate({size/2} {size/2}) scale({s:.6f}) translate({-cx:.4f} {-cy:.4f})"><g transform="{GROUP_TF}">'
            f'<path d="{VANE}" fill="{FEATHER}" stroke="{FEATHER}" stroke-width="{b}" stroke-linejoin="round"/>'
            f'<path d="{NIB}" fill="{GOLD}" stroke="{GOLD}" stroke-width="{b}" stroke-linejoin="round"/></g></g>')
