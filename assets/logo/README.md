# DaSignature brand asset pack (SPEC Sec 11)

Owner: Designer. Built from the master `../../dasignature-icon.svg` with no change to the mark. Every geometry string is copied verbatim into `source/parts.py`. All assets are flat, with no gradients, shadows, glows, filters or opacity.
Palette (Sec 11): navy `#141A3C`, off-white feather `#F6F3EC`, gold `#E8B04A`.

To rebuild: `python3 source/build_brand.py && python3 source/verify_brand.py`, run from this folder. Tools: librsvg (`rsvg-convert`) and the Python packages Pillow, numpy, uharfbuzz, fontTools and icnsutil.
Review: `review/contact-sheet.png` (safe-zone overlays) and `review/verify-report.md` (43/43 checks).

## Inventory → where it goes in the repo

| Folder | Files | Repo destination |
|---|---|---|
| `master/` | `dasignature-icon.svg` (cleaned master: rounded square rx 112, transparent corners, metadata stripped), `dasignature-icon-fullbleed.svg` (square, no corner radius, for platforms that apply their own mask), 1024 PNGs of both | `assets/logo/` |
| `ios/AppIcon.appiconset/` | 18-entry `Contents.json` + `AppIcon-{20,29,40,58,60,76,80,87,120,152,167,180,1024}.png`, all **RGB with no alpha**, full-bleed (iOS applies the corner mask) | `apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/` |
| `ios/AppIcon-1024-master.png` | 1024 marketing master (no alpha) | App Store Connect / Xcode single-size |
| `android/res/` | `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png`, `ic_launcher_monochrome.png` (108 dp: 108/162/216/324/432 px), legacy `ic_launcher.png` and `ic_launcher_round.png` (48 dp); `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` (background + foreground + monochrome); `values/ic_launcher_background.xml` (#141A3C) | merge into `apps/mobile/android/app/src/main/res/` |
| `android/source/` | foreground and monochrome SVGs (108-unit canvas) | `assets/logo/android/` |
| `android/play-store-512.png` | Play listing icon (full-bleed, no alpha) | store listing |
| `glyph/` | `glyph.svg` (`currentColor`), `glyph-navy` (for light backgrounds), `glyph-offwhite` (for dark backgrounds), `glyph-white`, `glyph-black`; each as SVG + 512/1024 PNG. Details are true cut-outs, so the glyph works in one ink. | `packages/ui/src/icons/` + `assets/logo/` |
| `pwa/` | `icon-192.png`, `icon-512.png` (purpose any), `maskable-192.png`, `maskable-512.png` (full-bleed navy, content inside 80%), `maskable.svg`, `apple-touch-icon-180.png`, `manifest-snippet.json` | `apps/web/public/icons/` |
| `favicon/` | `favicon.svg` (full mark), `favicon-16.svg` (simplified 16 px source), `favicon-16.png` (**simplified**), `favicon-32/48.png` (full mark), `favicon.ico` (16 simplified / 32 / 48) | `apps/web/public/` |
| `desktop/` | `dasignature.ico` (16/24/32/48/64/128/256), `dasignature.icns` (16–1024 incl. @2x; 824 px body on the 1024 Apple grid), `dasignature.png` (512), `png/dasignature-{16…1024}.png`, `macos/` sources | `apps/desktop/src-tauri/icons/` (`icon.ico`, `icon.icns`, `icon.png`, `32x32.png`, `128x128.png`, `128x128@2x.png` = 256) |
| `lockup/` | `lockup-light.svg` (navy wordmark, for light backgrounds) and `lockup-dark.svg` (#F6F3EC wordmark + 1 px #2A3163 tile hairline, for dark backgrounds), each @1x/@2x/@4x PNG (height 128/256/512); `wordmark-light/dark.svg` (text only) | `assets/logo/` |
| `source/` | `parts.py` (verbatim master geometry), `build_brand.py`, `verify_brand.py`, `fonts/` (Inter Regular + SemiBold OTF, OFL, build-time only) | `assets/logo/source/` |
| `review/` | `contact-sheet.png`, `verify-report.md`, `geometry.json` | not shipped |

## Construction notes
- **iOS:** the master on a full-bleed navy square. The corner radius is removed because iOS masks the icon itself, and the alpha channel is flattened.
- **Android adaptive:** the foreground is the feather + nib only, per Sec 11 (no signature stroke). The navy detail marks (notch, rachis, barbs, nib hole and slit) become transparent cut-outs, which look identical over the navy background layer. The mark is scaled so its minimal enclosing circle has a radius of 30 dp on the 108 dp canvas, inside the 66 dp (r 33) safe circle; measured max radius 30.14 dp. The monochrome layer is the same shape in white + alpha, and Android 13+ themed icons tint it.
- **PWA maskable:** the full mark (with signature stroke) on full-bleed navy, with its enclosing circle at 36% of the size, inside the 40% (80% diameter) safe zone. The "any" icons are the rounded-square master.
- **macOS:** the rounded-square master scaled to the 824 px Apple icon grid inside a 1024 canvas with a transparent margin. Windows and Linux use the master edge to edge.
- **Lockup:** the icon on the left at height H = 128; a gap of 0.25 H; the wordmark at 70 px. "Da" is Inter Regular and "Signature" is Inter SemiBold, shaped with HarfBuzz (kerning on), tracked −0.02em (`--tracking-wordmark`), with caps vertically centered on the icon. All text is converted to outlines, with no font dependency.

## Usage
- Minimum sizes: lockup 24 px tall (screen); icon or glyph 16 px.
- Clear space: 0.25 × icon height on every side.
- Use `lockup-light` on `--bg` / `--surface` and `lockup-dark` on dark surfaces. Don't recolor, rotate, stretch, outline, or add shadows or gradients.
- The gold (`#E8B04A`) in the mark is decorative (PM #33). In UI, use the glyph in `--text` or `--primary`, never gold alone as a state cue.
- Web: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="icon" href="/favicon.ico" sizes="32x32">`, `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">`, then merge `pwa/manifest-snippet.json` into the web manifest. Everything is local, so the strict CSP is fine.
- Tauri: in `tauri.conf.json`, set `bundle.icon` to the files copied above.

## Notes
- **Simplified 16 px variant (owner-approved):** this is used at exactly 16 px and nowhere else: `favicon-16.png`, the 16 slot of `favicon.ico`, `desktop/png/dasignature-16.png`, the 16 slot of `desktop/dasignature.ico`, and the `icp4` (16×16) slot of `.icns`, drawn on the Apple grid. It takes the master's vane and nib outlines as solid shapes, thickened by a 30-unit stroke in the same color, and scales them up (enclosing circle r 232 of 256). It drops the barbs, notch, rachis, nib slit and signature stroke, which are all under a pixel at 16 px. The palette and corner radius are the same, and it is flat. 32 px and larger, including the Retina 16@2x slot `ic11`, keep the full mark.
- **Dark lockup (updated, PM-approved):** `lockup-dark` has a 1 px hairline in dark `--border` (#2A3163) around the icon tile, so the tile separates from dark backgrounds. The light lockup has none. In PNGs it scales with the export (1/2/4 px at @1x/@2x/@4x).
- **Metadata hygiene:** every PNG is written from a fresh Pillow image, so the only chunks are IHDR, PLTE, tRNS, IDAT and IEND, with no text, EXIF, ICC or caBX chunks. ICOs are written with Pillow. SVGs contain no `<metadata>`, C2PA or XMP. `verify_brand.py` scans every PNG (including those embedded in .ico/.icns) and every SVG for C2PA/JUMBF, XMP, EXIF, ICC and AI-provenance strings, and fails on any hit. A negative test with an injected tEXt chunk was caught. The PM has stripped the master too; the check confirms it is valid XML and that its artwork is pixel-identical to the earlier build (`review/artwork-reference.json`).
