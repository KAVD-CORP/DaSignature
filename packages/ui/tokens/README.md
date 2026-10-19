# DaSignature design tokens (M1)

Owner: Designer. Source of truth: `tokens.json`. Everything else here is generated or checked from it.

| File | What it is |
|---|---|
| `tokens.json` | Source of truth, W3C Design Tokens (DTCG) format. `$value` = light, `$extensions["app.dasignature"].dark` = dark. For future native platforms (Swift/Kotlin generators). |
| `tokens.css` | CSS custom properties: light (`:root`), dark (`[data-theme="dark"]` plus a `prefers-color-scheme: dark` fallback), type, spacing, sizes, radius, motion, reduced-motion, base + focus styles. **Generated.** |
| `tailwind.preset.js` | Tailwind **v3.4** preset (the repo pins `tailwindcss ^3.4.17`). **Generated.** |
| `theme.css` | Tailwind **v4** `@theme` equivalent, in case of a later v4 move. **Generated.** |
| `contrast-report.md` | WCAG ratios for all 114 pairings in both themes. **Generated** by `check_contrast.py`. |
| `build.py` | `python3 build.py` regenerates tokens.css, theme.css and tailwind.preset.js. |
| `check_contrast.py` | `python3 check_contrast.py` checks that the Sec 8.2 hex values match the spec exactly, computes every ratio and applies the PM #31 rules. Exits 1 on any failure that isn't handled. |
| `lint-pairings.mjs` | `node lint-pairings.mjs apps/web/src packages/ui/src` lints class strings for banned pairings (PM #31). Exits 1 on a violation. |

Workflow: edit `tokens.json`, run `python3 build.py && python3 check_contrast.py`, then copy the outputs into `packages/ui/src/`. Never hand-edit generated files. Never change a `source: spec-*` value.

## Colors

The 11 Sec 8.2 tokens keep their spec names and exact hex values (`--bg --surface --surface-2 --text --text-muted --border --primary --on-primary --accent --danger --success`), so QA's `check-tokens.mjs` matches 22 of 22. Each added token is an alias of a spec or brand color, with one exception, a tint of `--success`. No new hues.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--on-accent` | = text #141A3C | = on-primary #141A3C | label on a gold fill |
| `--on-danger` | = on-primary #FFFFFF | = on-primary #141A3C | label on a danger fill |
| `--border-strong` | = text-muted | = text-muted | input, checkbox and toggle outlines (≥ 3:1); `--border` is for decorative hairlines only |
| `--focus-ring` | = primary (navy) | = accent (gold) | 2 px focus outline with a 2 px offset. Gold fails 3:1 on light, so light uses navy. |
| `--success-chip-bg` | #DEECE7 | #21374A | **Approved (PM #32), pinned exact hex (PM #47).** = the former 16% success-into-surface tint, frozen, so visuals are unchanged. Fill for the "Signed" status chip; label `--text`, optional `--success` icon. `check_contrast.py` verifies the pin still equals the derivation. |
| `--selection` | = accent | = accent | placement selection outline, 2 px (Sec 7.4; PM #33) |
| `--selection-halo` | #FFFFFF | #FFFFFF | 1 px inner halo inside the selection outline so it reads on any page color (PM #33) |
| `--pdf-page` / `--pdf-ink` | #FFFFFF / #141A3C | same | the PDF page is never inverted; on-page field previews and handle strokes use pdf-ink |
| `--canvas` | = surface-2 | = bg | editor backdrop behind pages (dims the chrome in dark) |
| `--scrim` | navy at 40% | near-black at 64% | overlay behind sheets and modals |
| `--brand-navy/feather/gold` | Sec 11 | same | logo and lockup only |

### Signature ink colors (`ink.*`, PM #44 / D5)
Theme-independent **content** colors for signature strokes and typed signatures, shown on the white PDF page and on signature previews. They are not UI chrome and never change with the theme. Tailwind: `text-ink-black`, `stroke-ink-blue`, and so on.

| Token (json / CSS / Tailwind) | Hex | On #FFFFFF / `--pdf-page` |
|---|---|---|
| `ink.black` / `--ink-black` / `ink-black` | #1B1F2A | 16.46:1 |
| `ink.blue` / `--ink-blue` / `ink-blue` | #1F3A8A | 10.34:1 |
| `ink.deep-red` / `--ink-deep-red` / `ink-deep-red` | #8B1E2B | 9.06:1 |
| `ink.graphite` / `--ink-graphite` / `ink-graphite` | #4B4F58 | 8.21:1 |

All of them are gated at ≥ 7:1 in `check_contrast.py`. Default ink = `ink.black`. Custom picker colors are user content, so they aren't gated; the Studio shows a "Low contrast" hint under 4.5:1 on white.

### Pairing rules (PM decision #31). The lint enforces these.
Light theme:
1. `--accent` is never text on light surfaces. Use it only for fills (label `--on-accent`), borders, selection and icons.
2. `--text-muted` only on `--bg` and `--surface`. On `--surface-2` and `--canvas`, use `--text`.
3. `--success` is never text. Show status with an icon, or a chip that has a `--success-chip-bg` fill and a `--text` label.

Both themes:
4. Labels on fills use the matching `on-*` token.
5. Nothing theme-colored goes on the PDF page.
6. Form controls use `--border-strong`.
7. No opacity modifiers on text colors.

Dark theme has no extra restrictions. Every permitted pairing is ≥ 4.5:1. See contrast-report.md.

Approved by the PM (#32, #33). No open contrast items remain.
- Status chips: `--success-chip-bg` fill and a `--text` label (13.89:1 light, 10.86:1 dark).
- Gold on light is decorative/emphasis only and never the sole state cue. Focus ring: navy in light, gold in dark.
- Selection: a 2 px gold `--selection` outline (`--size-selection-width`) plus a 1 px `--selection-halo` white inner halo (`--size-selection-halo-width`). Handles are a 12 px square (`--size-handle`) with a `--pdf-page` fill and a 1.5 px `--pdf-ink` stroke (`--size-handle-stroke`), 16.9:1 on the page. The hit area is `--size-target`. Ready-made classes in tokens.css: `.ds-selection` (outline plus `inset` halo) and `.ds-selection-handle`. Tailwind: `outline-selection outline-selection`.

## Type
Inter Variable, bundled through `@fontsource-variable/inter` with no remote fonts. The font stack is `"Inter Variable", Inter, system-ui…`. Hashes use a system mono stack.

| Token / Tailwind | Size / line | Weight | Tracking |
|---|---|---|---|
| `caption` / `text-xs` | 12/16 | 400 | +0.01em |
| `body-sm` / `text-sm` | 14/20 | 400 | 0 |
| `body` / `text-base` | 16/24 | 400 | 0 |
| `title` / `text-lg` | 20/28 | 600 | −0.01em |
| `headline` / `text-xl` | 28/36 | 600 | −0.02em |
| `display` / `text-2xl` | 36/44 | 600 | −0.022em |

Weights are `font-normal` 400, `font-medium` 500 and `font-semibold` 600, with no others. Sizes are in rem so dynamic type works. The wordmark uses `tracking-wordmark` (−0.02em). The `xs`…`2xl` keys keep the Engineer's existing preset mapping.

## Spacing, sizes, radius, elevation
- **Spacing:** 4 pt grid `--space-{0,1,2,3,4,5,6,8,10,11,12,16,20,24}`, where 1 = 4 px. The Tailwind numbers stay the same (`p-4` = 16 px).
- **Hit targets (PM #16, #52):** `--size-touch` is always 44 px. `--size-target` depends only on the **pointer**, at any viewport width (no breakpoint involved): 44 px by default (no pointer info), 44 px under `@media (pointer: coarse)`, 32 px under `@media (pointer: fine)`. So a narrow desktop window with a mouse gets 32, and a 1440 px touch screen gets 44. Use `min-h-target min-w-target` on every interactive element and `*-touch` to force 44.
  - **Hybrid devices** (touchscreen laptops, tablets with a keyboard/trackpad, Surface): the `pointer` media feature reports only the **primary** pointer, and that decides. A touchscreen laptop whose primary input is the trackpad gets 32 px; a tablet with a trackpad attached still gets 44 px (primary = touch). We deliberately don't use `any-pointer`/`any-hover` (PM #52).
- **Radius:** `rounded-input` 8, `rounded-card` 12, `rounded-sheet` 20 (top corners of bottom sheets), `rounded-full` pills. `rounded` defaults to 8.
- **Elevation:** flat. Hierarchy comes from the surface step plus a hairline border. The only shadow is `shadow-float`, used for the floating placement toolbar in light; it is `none` in dark. No gradients or glows.

## Motion
`--motion-fast` 150 ms (hover, press, toggles), `--motion-base` 200 ms (panels, popovers, toasts), `--motion-easing` `cubic-bezier(0,0,0.2,1)`. Sheets use `--motion-sheet` 400 ms with `--motion-spring`, a CSS `linear()` spring (stiffness 380, damping 30, about 2% overshoot, settling in about 300 ms) that falls back to `cubic-bezier(.32,.72,0,1)`. For a JS spring, use the same parameters from tokens.json. Under `prefers-reduced-motion: reduce`, or `<html data-motion="reduce">`, all durations drop to 0 and a global rule kills transitions and animations. The variable names match the Engineer's existing `--motion-*`.

## Breakpoints and viewports
`tablet:` ≥ 600, `desktop:` ≥ 1025, `wide:` ≥ 1440, `ultra:` ≥ 2560 (Sec 8.3). Use container queries for panels: `@tailwindcss/container-queries` on v3, built in on v4. QA matrix (PM #14): 320×568, 390×844, 768×1024, 1024×768, 1440×900, 2560×1440, plus landscape (swapped dimensions) for 320, 390 and 768.

## Theming
With no `data-theme`, the app follows the OS through the media query. `data-theme="light"` or `"dark"` on `<html>` forces a theme. This matches the existing `applyTheme()` in `packages/ui/src/theme.ts`, which removes the attribute for "system". Each block sets `color-scheme`. Components never need `dark:` because the variables swap. `darkMode: ['selector','[data-theme="dark"]']` exists only for rare overrides.

## Integration (Tailwind v3.4, current repo)
1. Replace `packages/ui/src/tokens.css` with `tokens.css`. It is a superset: the same spec variables plus the `--motion-*` names that already exist.
2. Either use `tailwind.preset.js` directly (`presets: [require('@dasignature/ui/tailwind-preset.js')]`) or port its object into `tailwind-preset.ts`. The color keys are unchanged (`bg-bg`, `text-text`, `text-text-muted`, …) and add `on-accent`, `on-danger`, `border-strong`, `focus-ring`, `success-chip-bg`, `selection`, `pdf-page`, `pdf-ink`, `canvas`, `scrim`, and `brand.*`.
3. Mirror the new colors into `tokens.ts` `colorTokens` if the sync unit test needs it. The aliases resolve to spec hex values, as listed above.
4. Keep `@import '@fontsource-variable/inter/index.css'` before the tokens.
5. CI: add `python3 design/tokens/check_contrast.py` (or a TS port of it) and `node lint-pairings.mjs apps/web/src packages/ui/src` to the lint step.

Tailwind v4: `@import "tailwindcss"; @import "./tokens.css"; @import "./theme.css";` and drop the preset.
