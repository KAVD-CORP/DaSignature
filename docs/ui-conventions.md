# UI conventions (contrast gate, theming, markers)

These rules apply to every UI primitive and screen. They keep QA's contrast gate
(`qa/scripts/check-tokens.mjs` Parts A-C, TEST_PLAN v0.3) measurable, and they follow
PM decisions #16, #31, #32, #33 and #43. M1 applies them in `apps/web/src/App.tsx` and
`apps/web/src/showcase/` (the token showcase at `/showcase.html`).

## Tokens and colour

- Use tokens only (Tailwind utilities from the `@dasignature/ui` preset, or `var(--token)`).
  No raw hex, rgb or hsl in components.
- Light-theme bans, enforced by `pnpm lint:pairings`:
  - `--accent` is never text on light surfaces. Use it for fills, borders, focus, selection and icons.
  - `--text-muted` goes only on `--bg` and `--surface`. On `--surface-2` or `--canvas`, use `--text`.
  - `--success` is never text. Show status with an icon, or a `bg-success-chip-bg` chip with a
    `text-text` label (PM #32).
- Text on a gold fill uses `text-on-accent`. Text on other fills uses the matching `on-*` token.
- Never put theme text on the white PDF page. Use `--pdf-ink` (`text-pdf-ink`) there; the page is
  never inverted.
- No opacity modifiers on text colours.

## State-bearing UI (non-text contrast >= 3:1, PM #43)

- Checkbox, radio and switch boundaries use `--border-strong` (`border-border-strong`) or a filled
  state (`bg-primary`), never `--border`. `--border` is for decorative hairlines only.
- Inputs use `border-border-strong`; invalid inputs get `aria-invalid="true"` and a `--danger` border.
- Never remove a focus outline (`:focus-visible` uses `--focus-ring`: navy in light, gold in dark,
  2px with a 2px offset) unless the replacement indicator reaches at least 3:1.
- Gold is never the only state cue (PM #33).

## QA markers (adopted from TEST_PLAN v0.3)

| Marker                                              | Put it on                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `data-ui-state="handle"`                            | each selection handle                                                                                                              |
| `data-ui-state="checkbox"` / `"switch"` / `"radio"` | the element that draws the control's boundary (the element with the ARIA role, so the role and the measured box are the same node) |
| `data-ui-state="input"`                             | text inputs                                                                                                                        |
| `data-ui-state="selected"`                          | list or grid items with a selected state                                                                                           |
| `data-ui-state="icon"`                              | meaningful icons (with an accessible name)                                                                                         |
| `data-ui-state="selection"`                         | the selection outline box (`.ds-selection`)                                                                                        |
| `data-decorative`                                   | purely decorative gold or brand art (logo, flourishes)                                                                             |
| `data-qa-backdrop="#FFFFFF"`                        | the overlay container above the PDF canvas, declaring what is painted underneath                                                   |

## Selection on the PDF page (Sec 7.4, PM #33)

- Selection outlines and handles are **DOM elements** using the Designer classes `.ds-selection`
  (2px gold outline + 1px white inset halo) and `.ds-selection-handle` (12px square, white fill,
  1.5px navy stroke). Never draw them inside a canvas.
- The overlay above the PDF canvas carries `data-qa-backdrop="#FFFFFF"`.

## Hit targets (PM #16 + #52, deliberate deviation)

- Every interactive element gets `min-h-target min-w-target` (44px when the primary pointer is coarse or unknown, 32px when it is fine, at any width; PM #52).
  Use `*-touch` to force 44px. If the visual box is smaller (a 20px checkbox), enlarge the hit area
  with a pseudo-element rather than padding the measured box.

## Demo and E2E pages

- Demo/showcase pages and E2E fixtures render **both states** of every control (checked/unchecked,
  on/off, selected/unselected, valid/invalid), so both are measured.
