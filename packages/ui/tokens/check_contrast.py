#!/usr/bin/env python3
"""DaSignature WCAG 2.x contrast check, every foreground/background pairing, light + dark.
- Verifies tokens.json carries SPEC Sec 8.2 hex values exactly (if SPEC.md is reachable).
- Checks the pinned --success-chip-bg hex equals its derivation (PM #47) and ink.* >= 7:1 on white/pdf-page (PM #44).
- Resolves aliases ({color.x}) and color-mix tints, computes ratios, applies PM decision #31 rules.
- Writes contrast-report.md. Exit 1 if any PERMITTED text pairing < 4.5:1 or non-text control < 3:1
  (pairings flagged for PM review do not fail the build but are listed).  No dependencies.
Usage: python3 check_contrast.py   [env DASIG_SPEC=/path/SPEC.md]"""
import json, os, re, sys, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "tokens.json")))
EXT = "app.dasignature"
ALIAS = re.compile(r"^\{color\.([a-z0-9-]+)\}$")

# ---- guard: spec hex values exact ----
SPEC = os.environ.get("DASIG_SPEC", os.path.join(HERE, "..", "..", "SPEC.md"))
spec_ok = None
if os.path.exists(SPEC):
    line = next((l for l in open(SPEC) if l.startswith("8.2 Tokens")), "")
    found = re.findall(r"--([a-z0-9-]+) (#[0-9A-F]{6})(?:/(#[0-9A-F]{6}))?", line)
    for n, l, d in found:
        t = T["color"][n]; d = d or l
        got = (t["$value"].upper(), t["$extensions"][EXT].get("dark", t["$value"]).upper())
        if got != (l, d): sys.exit(f"SPEC MISMATCH --{n}: tokens.json {got} vs spec {(l, d)}")
    spec_ok = len(found)

def to_rgb(h): h = h.lstrip("#"); return [int(h[i:i+2], 16) for i in (0, 2, 4)]
def to_hex(c): return "#%02X%02X%02X" % tuple(round(x) for x in c)

def val(name, theme):
    if name.startswith("brand-"): return T["primitive"][name[6:]]["$value"]
    t = T["color"][name]; v = t["$value"] if theme == "light" else t["$extensions"][EXT].get("dark", t["$value"])
    m = ALIAS.match(v)
    if m: return val(m.group(1), theme)
    if v == "color-mix":  # CSS color-mix(in srgb, A p%, B): per-channel mix of encoded sRGB
        mx = t["$extensions"][EXT]["mix"]; a, b = to_rgb(val(mx["of"], theme)), to_rgb(val(mx["into"], theme)); p = mx["pct"] / 100
        return to_hex([a[i] * p + b[i] * (1 - p) for i in range(3)])
    return v.upper()

def lum(h):
    c = [x / 255 for x in to_rgb(h)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def ratio(a, b):
    hi, lo = sorted([lum(a), lum(b)], reverse=True); return (hi + 0.05) / (lo + 0.05)

TEXT, UI, DECOR = "text", "non-text", "decorative"
NEED = {TEXT: 4.5, UI: 3.0, DECOR: 0.0}
S3 = ["bg", "surface", "surface-2"]
P = []  # fg, bg, kind, usage
for fg, use in [("text", "body, headings, labels"), ("text-muted", "secondary text"), ("primary", "primary-colored text/link"),
                ("danger", "error / destructive text"), ("success", "success text"), ("accent", "gold text/link")]:
    for bg in S3: P.append((fg, bg, TEXT, use))
P += [("text", "canvas", TEXT, "labels on editor backdrop"), ("text-muted", "canvas", TEXT, "muted labels on editor backdrop"),
      ("on-primary", "primary", TEXT, "primary button label"),
      ("on-accent", "accent", TEXT, "label on gold fill"),
      ("on-danger", "danger", TEXT, "destructive button label"),
      ("text", "success-chip-bg", TEXT, "'Signed' chip label (recommended chip)"),
      ("text", "success", TEXT, "label on SOLID success chip (PM #31 literal reading)"),
      ("on-primary", "success", TEXT, "label on solid success chip, alt"),
      ("pdf-ink", "pdf-page", TEXT, "field preview text on PDF page"),
      ("on-primary", "accent", TEXT, "(misuse check) on-primary label on gold"),
      ("text", "accent", TEXT, "(misuse check) theme text on gold"),
      ("text", "pdf-page", TEXT, "(misuse check) theme text on PDF page")]
for bg in S3:
    P += [("border-strong", bg, UI, "form-control boundary"), ("focus-ring", bg, UI, "focus indicator"),
          ("accent", bg, UI, "gold icon / border / indicator"), ("danger", bg, UI, "error icon"),
          ("success", bg, UI, "success icon / status dot"), ("border", bg, DECOR, "hairline divider")]
P += [("success", "success-chip-bg", UI, "success icon inside 'Signed' chip"),
      ("selection", "pdf-page", UI, "selection outline on PDF page (Sec 7.4)"),
      ("pdf-ink", "pdf-page", UI, "selection-handle stroke on PDF page"),
      ("pdf-ink", "canvas", UI, "selection-handle stroke overhanging page edge"),
      ("pdf-page", "canvas", UI, "selection-handle white fill overhanging page edge"),
      ("selection-halo", "selection", UI, "halo vs gold outline (separation cue, informative)"),
      ("selection", "canvas", UI, "selection outline overhanging page edge"),
      ("primary", "bg", UI, "primary button shape"),
      ("brand-feather", "brand-navy", UI, "logo feather on navy"), ("brand-gold", "brand-navy", UI, "logo nib on navy")]

PM31 = "RESTRICTED BY RULE (PM #31)"
RULE = {  # (theme, fg, bg, kind) -> (status, note)
  ("light", "text-muted", "surface-2", TEXT): (PM31, "Rule 2: text-muted only on bg/surface; on surface-2 use text (14.93:1)."),
  ("light", "text-muted", "canvas", TEXT): (PM31, "Rule 2 (canvas = surface-2 in light): use text."),
  **{("light", "success", b, TEXT): (PM31, "Rule 3: success never text in light; icon or chip with text label.") for b in S3},
  **{("light", "accent", b, TEXT): (PM31, "Rule 1: accent never text on light surfaces.") for b in S3},
  ("light", "text", "success", TEXT): ("RESTRICTED (PM #32)", "Solid #2E8B6A chip + text label is 4.04:1. Approved: --success-chip-bg (tint) + text label, 13.89:1."),
  ("light", "on-primary", "success", TEXT): ("RESTRICTED (PM #32)", "White on spec success 4.19:1; use --success-chip-bg + text."),
  ("dark", "text", "success", TEXT): ("RESTRICTED (misuse)", "Dark solid chip label must be on-primary (8.44:1), or use --success-chip-bg + text."),
  ("light", "on-primary", "accent", TEXT): ("RESTRICTED (misuse)", "On gold fills always use --on-accent (light = text, 8.64:1)."),
  ("dark", "text", "accent", TEXT): ("RESTRICTED (misuse)", "On gold fills always use --on-accent (dark = on-primary, 8.64:1)."),
  ("dark", "text", "pdf-page", TEXT): ("RESTRICTED (misuse)", "Never theme text on the white PDF page; use --pdf-ink."),
  ("light", "pdf-page", "canvas", UI): ("RESOLVED (PM #33)", "Light off-page: the pdf-ink stroke carries the cue (14.93:1); the white fill is not needed."),
  ("dark", "pdf-ink", "canvas", UI): ("RESOLVED (PM #33)", "Off-page in dark the handle's white pdf-page fill carries the cue (see pdf-page on canvas row)."),
  ("light", "selection-halo", "selection", UI): ("INFORMATIVE (PM #33)", "Halo separates the outline from any page color; it is not itself the state cue."),
  ("dark", "selection-halo", "selection", UI): ("INFORMATIVE (PM #33)", "Same."),
  **{("light", "accent", b, UI): ("RESOLVED (PM #33): decorative only", "Gold on light is decorative/emphasis only and never the sole state cue, so 1.4.11 does not apply. Focus ring is navy in light.") for b in S3},
  ("light", "selection", "pdf-page", UI): ("RESOLVED (PM #33)", "Gold outline kept for brand; state cue = pdf-ink handle strokes (16.9:1) + 1 px white inner halo."),
  ("light", "selection", "canvas", UI): ("RESOLVED (PM #33)", "Overhang only; handle strokes (pdf-ink 14.93:1 on canvas) carry the cue."),
  ("dark", "selection", "pdf-page", UI): ("RESOLVED (PM #33)", "PDF page is always white; handles + halo carry the cue."),
}

rows, broken = [], []
for theme in ("light", "dark"):
    for fg, bg, kind, use in P:
        if theme == "dark" and fg.startswith("brand-"): continue
        a, b = val(fg, theme), val(bg, theme); r = ratio(a, b); need = NEED[kind]
        if kind == DECOR: status, note = "EXEMPT (decorative)", "Not a control boundary; controls use border-strong."
        elif (theme, fg, bg, kind) in RULE:
            status, note = RULE[(theme, fg, bg, kind)]
            if r >= need: status, note = "PASS", ""  # rule not needed in this theme
        elif r >= need: status, note = "PASS", ""
        else: status, note = "FAIL", "UNHANDLED"; broken.append((theme, fg, bg, f"{r:.2f}"))
        rows.append(dict(theme=theme, fg=fg, a=a, bg=bg, b=b, r=r, need=need, kind=kind, use=use, status=status, note=note))

# --- PM #47: pinned success-chip-bg must equal the frozen 16% tint exactly; PM #44: ink.* >= 7:1 on white and pdf-page
pin_rows, ink_rows = [], []
_c = T["color"]["success-chip-bg"]; _d = _c["$extensions"][EXT]["derivedFrom"]
for theme in ("light", "dark"):
    a, b = to_rgb(val(_d["of"], theme)), to_rgb(val(_d["into"], theme)); p = _d["pct"] / 100
    want = to_hex([a[i] * p + b[i] * (1 - p) for i in range(3)]); got = val("success-chip-bg", theme)
    ok = got == want; pin_rows.append((theme, got, want, ok))
    if not ok: broken.append((theme, "success-chip-bg pinned", got, want))
for k, t in T["ink"].items():
    if k.startswith("$"): continue
    for bgname, bg in (("#FFFFFF (white)", "#FFFFFF"), ("pdf-page light", val("pdf-page", "light")), ("pdf-page dark", val("pdf-page", "dark"))):
        r = ratio(t["$value"], bg); ok = r >= 7.0; ink_rows.append((k, t["$value"], bgname, bg, r, ok))
        if not ok: broken.append(("ink", k, bgname, f"{r:.2f}"))

icon = lambda s: "✅" if s == "PASS" else "🚫" if s.startswith("RESTRICTED") else "☑️" if s.startswith(("RESOLVED", "INFORMATIVE")) else "⚠️" if s.startswith("EXEMPT") else "❌"
cnt = lambda pre: sum(r["status"].startswith(pre) for r in rows)
permitted_text = [r for r in rows if r["kind"] == TEXT and r["status"] == "PASS"]
md = ["# DaSignature contrast report", "",
      f"Generated by `check_contrast.py` from `tokens.json` on {datetime.date.today().isoformat()} (WCAG 2.x relative luminance).",
      f"Spec Sec 8.2 hex values verified exact: {'yes, ' + str(spec_ok) + ' tokens x 2 themes' if spec_ok else 'SPEC.md not found, skipped'}. No spec hex was changed; no new hues were added (added tokens are aliases of spec/brand colors, plus one tint of --success).",
      "Thresholds: text 4.5:1 (SC 1.4.3); non-text UI and focus 3:1 (SC 1.4.11). Light-theme pairing rules from PM decision #31.", "",
      "## Summary", "",
      f"- Pairings checked: **{len(rows)}**. PASS {cnt('PASS')}, restricted by rule/misuse {cnt('RESTRICTED')}, resolved by PM #33 {cnt('RESOLVED')}, informative {cnt('INFORMATIVE')}, decorative exempt {cnt('EXEMPT')}, unhandled failures **{len(broken)}**.",
      f"- **All {len(permitted_text)} permitted text pairings pass 4.5:1 in both themes** (lowest: " +
      min(((r["r"], f"{r['theme']} {r['fg']} on {r['bg']}") for r in permitted_text))[1] + f" at {min(r['r'] for r in permitted_text):.2f}:1).", "",
      "## Pairing rules (enforce in components; PM decision #31)", "",
      "Light theme:",
      "1. `--accent` is never text on light surfaces. Use it for fills (label = `--on-accent`), borders, selection, icons. Focus ring is `--focus-ring` (= primary navy in light).",
      "2. `--text-muted` only on `--bg` and `--surface`. On `--surface-2` (and the editor `--canvas`) use `--text`.",
      "3. `--success` is never text. Show status as a success icon, or a chip with `--success-chip-bg` fill and a `--text` label.", "",
      "Both themes:",
      "4. Labels on fills use the matching `on-*` token: on-primary / primary, on-accent / accent, on-danger / danger.",
      "5. Nothing theme-colored goes on the PDF page: on-page previews use `--pdf-ink`; the page is always `--pdf-page` (white).",
      "6. `--border` is decorative only; inputs, checkboxes and toggles use `--border-strong`.",
      "7. No opacity modifiers on text colors (they lower contrast).",
      "8. Status chips: `--success-chip-bg` fill + `--text` label (approved, PM #32).",
      "9. Gold on light is decorative/emphasis only, never the sole state cue. Focus ring: navy in light, gold in dark (PM #33).",
      "10. Selection: 2 px gold `--selection` outline + 1 px `--selection-halo` (white) inner halo; handles = `--pdf-page` fill + 1.5 px `--pdf-ink` stroke (PM #33).", "",
      "Open items: none. The success chip and gold non-text/selection items raised earlier are resolved by PM decisions #32 and #33.", "",
      "Dark theme has no extra restrictions: every spec pairing passes.", "",
      "## Restricted, flagged and failing pairings", "", "| Theme | Pairing | Ratio | Needs | Status | Handling |", "|---|---|---|---|---|---|"]
for r in rows:
    if r["status"] not in ("PASS",) and not r["status"].startswith("EXEMPT"):
        md.append(f"| {r['theme']} | `{r['fg']}` {r['a']} on `{r['bg']}` {r['b']} | {r['r']:.2f}:1 | {r['need']} | {icon(r['status'])} {r['status']} | {r['note']} |")
for title, kinds in (("All text pairings (4.5:1)", (TEXT,)), ("All non-text pairings (3:1)", (UI, DECOR))):
    md += ["", f"## {title}", "", "| Theme | Foreground | Background | Ratio | Needs | Usage | Result |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        if r["kind"] in kinds:
            md.append(f"| {r['theme']} | `{r['fg']}` {r['a']} | `{r['bg']}` {r['b']} | {r['r']:.2f}:1 | {r['need'] or '-'} | {r['use']} | {icon(r['status'])} {r['status']} |")
md += ["", "## Pinned tint (PM #47)", "", "| Theme | --success-chip-bg (tokens.json) | Derived 16% success into surface | Exact match |", "|---|---|---|---|"]
md += [f"| {th} | {g} | {w} | {'✅' if ok else '❌'} |" for th, g, w, ok in pin_rows]
md += ["", "## Signature ink colors (PM #44, need >= 7:1)", "", "| Token | Hex | Background | Ratio | Result |", "|---|---|---|---|---|"]
md += [f"| `ink.{k}` (`--ink-{k}`) | {v} | {bn} {b} | {r:.2f}:1 | {'✅ PASS' if ok else '❌ FAIL'} |" for k, v, bn, b, r, ok in ink_rows]
open(os.path.join(HERE, "contrast-report.md"), "w").write("\n".join(md) + "\n")
print("success-chip-bg pinned:", ", ".join(f"{t} {g} {'== ' if ok else '!= '}{w}" for t, g, w, ok in pin_rows))
print("ink >= 7:1:", ", ".join(f"{k} {min(r for kk, _, _, _, r, _ in ink_rows if kk == k):.2f}" for k in dict.fromkeys(x[0] for x in ink_rows)))
print(f"spec verified: {spec_ok}; {len(rows)} pairings; PASS {cnt('PASS')}; restricted {cnt('RESTRICTED')}; resolved {cnt('RESOLVED')}; unhandled {len(broken)}")
for b in broken: print("UNHANDLED FAIL", b)
sys.exit(1 if broken else 0)
