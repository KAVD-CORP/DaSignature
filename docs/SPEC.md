# DaSignature: Build Specification (source of truth, from the owner)
A private, open-source, cross-platform PDF signing app. Section 1 is the master prompt; Sections 2-13 are detailed specs.

## 1. Master Prompt
Build DaSignature, an open-source, local-first PDF e-signature app that runs on iOS, Android, Windows, macOS, Linux and the web (installable PWA) from ONE shared TypeScript codebase.
Core flow: import PDF -> create a signature (draw / type / upload / scan) -> drag, resize and rotate it onto any page -> export a NEW flattened PDF with the signature embedded. The original file is never modified.
Non-negotiable constraints:
1. Privacy by architecture. No backend, no database server. Documents, signatures and settings never leave the device. Web host serves only static files. No analytics, telemetry, or third-party network calls at runtime. All fonts, workers and WASM bundled.
2. Storage is SQLite on-device behind a StorageAdapter interface (SQLite WASM + OPFS on web, native SQLite on mobile and desktop). Sensitive data encrypted at rest.
3. Lightweight. Web initial JS < 250 KB gzipped (PDF engine and signature studio lazy-loaded), Android APK < 25 MB, desktop installer < 20 MB. Fast cold start, smooth 60 fps pen input.
4. Responsive and adaptive. One UI across phone, tablet, desktop (Section 8). Touch, mouse, trackpad, Apple Pencil, stylus.
5. Clean minimalist design, light/dark following system by default, tokens in Section 8.
6. Open source (Apache-2.0), documented, tested, with CI.
Stack (fixed unless strong documented reason): React 18 + TypeScript (strict) + Vite, Zustand, Tailwind CSS with CSS variable tokens, Radix UI, pdf.js (render), pdf-lib (write/export), perfect-freehand (strokes), Capacitor (iOS/Android), Tauri 2 (desktop), Vitest + Playwright.
Deliver in order, committing after each milestone (Section 12): scaffolding, storage, PDF viewer, signature studio, placement editor, export, settings and security, platform shells, polish, docs and CI. After each milestone run tests and show what works. Do not skip ahead. Ask only if truly ambiguous; otherwise choose the simplest option satisfying the spec and note it in docs/decisions.md.
Definition of done: every acceptance criterion in Section 13 passes on web (Chrome, Safari, Firefox), an Android device/emulator, an iOS simulator, and one desktop OS.

## 2. Product Principles
- Fast to the point: open app to signed PDF in < 60 s, no account, no sign-up.
- Your files stay yours: everything local; sharing is always explicit (share sheet or save).
- Honest about legality: simple e-signatures; say clearly what it is and is not (Section 9).
- Quiet UI: few controls at a time, generous whitespace, one accent color, clear hierarchy.

## 3. Feature Scope
### 3.1 MVP (v1.0)
| Area | Features |
|---|---|
| Import | File picker, drag and drop (web/desktop), share-sheet 'Open in DaSignature' (iOS/Android), file association (desktop), Web Share Target (PWA). Password-protected PDFs (prompt). Files up to 50 MB. |
| Viewer | Continuous scroll, thumbnails, pinch zoom, fit-width, page jump, lazy rendering with virtualized list; text layer not required. |
| Signature Studio | Draw (pen settings), Type (bundled script fonts), Upload image (auto background removal), Camera scan. Save many signatures and initials, name, set default. |
| Pen controls | Weight, thinness, smoothing, color, opacity, presets (Sec 7). Undo, redo, clear, baseline guide, live preview. |
| Placement | Drag onto any page, resize handles, rotate, duplicate, delete, arrow-key nudge, snap guides, multiple pages. |
| Extra fields | Initials, Date (auto, locale-aware, editable format), Text box, Checkbox, Full name. |
| Export | New file <original>-signed.pdf, signature flattened as vector, original untouched, share/save via native sheet or download. |
| Library | Home with recent docs, status (draft/signed), search, delete. Auto-save placement drafts. |
| Settings | Theme (system/light/dark), language, default date format, app lock, backup/restore, storage usage, clear all data. |
### 3.2 Also included
- Initials, date/text/checkbox fields.
- App lock with biometrics (Face ID, fingerprint, Windows Hello/Touch ID) or passcode, auto-lock timeout.
- Encrypted backup/restore to a single .dasig file (cross-device without server).
- Multi-signer by file exchange; each export adds an entry to the in-PDF audit trail.
- Audit certificate page (optional): appended page with doc SHA-256, signer name, timestamp with TZ, app version, platform. Never IP or location.
- Signed-document integrity check (hash vs embedded record).
- Page tools: reorder, rotate, delete, merge PDFs, image-to-PDF (camera/gallery).
- AcroForm fill.
- Basic annotations: text, highlight, draw (reuse pen engine).
- i18n with RTL, locale-aware dates/numbers; English first, community-translation ready.
- Accessibility: WCAG 2.2 AA, screen reader labels, full keyboard, reduced motion, 44x44 pt targets, dynamic type.
- Offline-first PWA.
- Palm rejection, stylus priority, pressure and tilt.
- Templates and saved placements stored locally.
- Desktop shortcuts (Ctrl/Cmd+O, S, Z, Shift+Z, E, +/-).
- Large-file safety: progress, cancelable export, memory-safe rendering.
### 3.3 v1.1+ (design for, don't build)
PAdES with user PKCS#12 (keep export pipeline modular via SignatureBackend); RFC 3161 timestamp (opt-in, disclosed network call); E2EE peer transfer (QR/local link); plugin API for fonts/templates.

## 4. Tech Stack
UI React+TS+Vite; Styling Tailwind + CSS variables; State Zustand; PDF render pdf.js in Web Worker; PDF write pdf-lib; Strokes perfect-freehand; Mobile Capacitor; Desktop Tauri 2; Storage SQLite; Tests Vitest, Playwright, Detox-style emulator smoke tests; Hosting any static host.
Platform code behind small interfaces (StorageAdapter, FileAdapter, ShareAdapter, BiometricAdapter); UI never imports Capacitor or Tauri directly.

## 5. Architecture
UI (Library | Viewer/Editor | Signature Studio | Settings) -> State (Zustand), i18n, theme tokens -> Services (DocumentService, SignatureService, PlacementService, ExportService, AuditService, BackupService, PenEngine, LockService, SettingsService) -> PDF Worker (pdf.js, pdf-lib) | Crypto (WebCrypto AES-GCM, Argon2/PBKDF2) | Platform adapters -> WEB: SQLite WASM + OPFS, Service Worker; NATIVE: SQLite (+SQLCipher), Capacitor plugins, Tauri (Rust). Static hosting only.
Rules:
1. Local-first, zero-knowledge. Strict CSP (default-src 'self'; connect-src 'none'-style) and a CI test failing on any outbound request.
2. Heavy work (parse, raster, hash, export) in Web Workers.
3. Vector-first signatures: strokes as point arrays with pressure; export as vector paths. PNG only for upload/scan.
4. Non-destructive: original bytes stored once untouched; placements are metadata; signed PDF generated at export.
5. Normalized coordinates (0..1 of page w/h, rotation degrees). At export convert to PDF points with origin flip, respecting /Rotate and CropBox.
6. Lazy loading: viewer, studio, export as separate chunks.
### 5.1 Repo layout
dasignature/ apps/{web (Vite PWA), mobile (Capacitor ios/android), desktop (Tauri 2 src-tauri)}; packages/{core (services, types, PenEngine, ExportService), ui (design system, tokens, icons), storage (adapters + migrations), pdf (worker wrappers), i18n}; docs/ (architecture.md, decisions.md, privacy.md, CONTRIBUTING.md); assets/ (logo, icons, OFL fonts); .github/workflows (lint, typecheck, test, build all targets).

## 6. Data and Storage
| Platform | DB | Files |
|---|---|---|
| Web/PWA | @sqlite.org/sqlite-wasm, OPFS sahpool VFS in a worker | OPFS |
| iOS/Android | Native SQLite + SQLCipher via Capacitor SQLite plugin | App sandbox |
| Desktop | SQLite via Tauri (rusqlite + SQLCipher) | App data dir |
Web: navigator.storage.persist(), one-time note that browser storage can be cleared, promote Backup.
Encryption: Native SQLCipher, random 256-bit key in Keychain/Keystore/OS credential store. Web: AES-256-GCM via WebCrypto on sensitive columns and blobs; random data key wrapped by key derived from app-lock passcode (Argon2id WASM, PBKDF2 high-iteration fallback); no lock -> device-bound key + tell user passcode adds protection. Backups (.dasig) always encrypted with user password.
### Schema
```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); -- id uuid v7; status draft|signed
CREATE TABLE signatures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, strokes_json TEXT, svg_path TEXT, image_ref TEXT, typed_text TEXT, font_id TEXT, color TEXT, opacity REAL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); -- kind signature|initials; source draw|type|image|scan
CREATE TABLE placements (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_index INTEGER NOT NULL, type TEXT NOT NULL, signature_id TEXT REFERENCES signatures(id) ON DELETE SET NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, rotation REAL NOT NULL DEFAULT 0, opacity REAL NOT NULL DEFAULT 1, data_json TEXT, z_index INTEGER NOT NULL DEFAULT 0); -- type signature|initials|date|text|checkbox|annotation; x,y top-left normalized
CREATE TABLE exports (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, signer_name TEXT, created_at TEXT NOT NULL);
CREATE TABLE pen_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings_json TEXT NOT NULL);
CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, placements_json TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_placements_doc ON placements(document_id, page_index);
```
### StorageAdapter
```ts
interface StorageAdapter {
  init(opts: { key?: CryptoKey | string }): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  putFile(bytes: Uint8Array, hint?: string): Promise<string>;
  getFile(ref: string): Promise<Uint8Array>;
  deleteFile(ref: string): Promise<void>;
  usage(): Promise<{ used: number; quota?: number }>;
}
```
Adapter contract tests must run against every implementation.

## 7. Signature and Pen Engine
7.1 Pointer Events with getCoalescedEvents(), pressure, tiltX/Y, pointerType; velocity-simulated pressure for mouse/finger. perfect-freehand outline on canvas with DPR scaling; separate preview layer. Store raw [x,y,pressure,t] + settings in strokes_json; final outline once into SVG path. Opacity applies to whole signature as a group (no darker overlaps); on export wrap in graphics state with constant alpha. touch-action:none, palm rejection when stylus active, no page scroll while drawing.
7.2 Pen settings (live, with preview stroke): Weight 0.5-16 px; Thinness 0-1; Taper 0-100%; Smoothing 0-1 (streamline); Color palette + picker + hex (defaults ink black, ink blue, deep red, graphite); Opacity 10-100% (group); Pressure on/off; Nib angle 0-90 deg (Calligraphy only). Presets: Fine Liner, Ballpoint, Fountain, Calligraphy, Marker; user presets saved.
7.3 Type: 8-10 bundled OFL script fonts (Caveat, Dancing Script, Mr Dafoe, Homemade Apple, Sacramento...), glyphs to outlines on export. Upload: PNG/JPG, auto white-bg removal (adaptive threshold), crop, contrast, tint. Scan: camera + same pipeline.
7.4 Placement editor: pick from bottom bar (mobile) / side panel (desktop), tap or drag onto page. Selected: thin accent outline, 4 corner handles (aspect locked by default), rotate handle, floating toolbar (duplicate, opacity, delete). Snap to center, margins, other objects. Arrow 1 px, Shift+arrow 10 px. Pinch zoom keeps selection, two-finger pan. Full undo/redo.
7.5 Export (pdf-lib, worker): 1 load original, verify SHA-256; 2 px = x*pageWidth, py = pageHeight - (y+h)*pageHeight, account for /Rotate and CropBox; 3 drawSvgPath for vectors, embedPng for images, embedded fonts for text, vector checkmarks, opacity via graphics state; 4 flatten filled AcroForm; 5 optional audit page; 6 metadata Producer "DaSignature <version>", custom info signer+timestamp, no location/IP; 7 save new file, SHA-256, exports row, hand to share/save adapter. Must open in Acrobat, Preview, Chrome, Foxit, mobile viewers. Golden-file render tests.

## 8. UI/UX Design System
8.1 Paper-and-ink, whitespace, flat hairline borders, almost no shadows, one gold accent sparingly. No gradients. Lucide line icons for empty states only.
8.2 Tokens (light / dark): --bg #FAFAF8/#0E1126; --surface #FFFFFF/#161B3A; --surface-2 #F1F1EE/#1D2347; --text #141A3C/#F2F1EC; --text-muted #6B7090/#A3A8C8; --border #E4E4EC/#2A3163; --primary #141A3C/#E8B04A; --on-primary #FFFFFF/#141A3C; --accent #E8B04A both; --danger #C23B3B/#F07C7C; --success #2E8B6A/#5CCB9E.
Type Inter variable bundled; scale 12/14/16/20/28/36; weights 400/500/600. 4 pt grid. Radius 8 inputs, 12 cards, 20 sheets, full pills. Motion 150-200 ms ease-out, spring sheets, off under prefers-reduced-motion. Text contrast >= 4.5:1 both themes. Never invert PDF in dark mode; dim chrome.
8.3 Responsive: Phone <600 single column, bottom tabs (Library, Signatures, Settings), editor bottom dock + bottom sheets, thumbnails swipe-up sheet. Tablet 600-1024 canvas + collapsible right panel, library 2-3 col grid, landscape and split-screen. Desktop >1024 three panes (thumbnails left collapsible, canvas, properties/signatures right), top toolbar (undo/redo, zoom, export), native menus and shortcuts. Container queries, fluid; safe areas, keyboard avoidance, foldables. Test 320, 390, 768, 1024, 1440, 2560.
8.4 Screens: 1 Onboarding (3 skippable cards: 'Your files never leave your device', 'Sign in seconds', 'Open source'; ask signer name). 2 Library (search, recent grid/list with thumbnail + status chip, big 'Open PDF', empty state drop zone). 3 Editor (canvas, thumbnails, field dock Signature/Initials/Date/Text/Checkbox, undo/redo, zoom, Export). 4 Signature Studio (full-screen sheet phone, modal desktop; tabs Draw/Type/Upload/Scan; pad with baseline; pen drawer; Clear/Undo/Save). 5 Signatures gallery (default, rename, delete). 6 Export sheet (filename, 'Add audit page', 'Flatten form fields', Save/Share, success with file + hash). 7 Settings (Appearance, Language, Signer name, Date format, App lock, Backup and restore, Storage usage, Privacy statement, OSS licenses, About).
8.5 One primary button (bottom-right desktop, bottom-center mobile). Destructive = confirm sheet + undo toast. Library footer: lock icon + 'Stored on this device only'.

## 9. Security, Privacy, Legal
No accounts, cookies, analytics, remote fonts/CDNs. Lockfile, npm audit, license check in CI. Reproducible builds where possible. Strict CSP, Referrer-Policy no-referrer, X-Content-Type-Options nosniff, SRI, versioned SW cache. Sanitize and size-limit imports; parse PDFs only in worker; never execute PDF JavaScript. Wipe decrypted data where feasible; no clipboard of signatures.
Legal (Privacy, About, README): simple electronic signatures under US ESIGN/UETA, EU eIDAS SES level, similar elsewhere. Not QES/AES in v1.0; some docs (wills, certain property/notarized) may need more. Short non-blocking notice linking plain-language explanation. Not legal advice.

## 10. Cross-border / Cross-platform
ICU i18n, RTL, locale dates/numbers/TZ; dates stored ISO 8601 with offset. Embedded Unicode fonts in PDF output (Latin, Cyrillic, Greek, Arabic, CJK fallback via lazy subsets). .dasig = encrypted ZIP with JSON manifest, documented open format. Same data format on every platform (Android backup restores on desktop).

## 11. Branding
Name: DaSignature (one word, capital D and S). Logo: feather quill, shaft ending in gold calligraphy nib, ~34 deg lean, flowing signature stroke beneath. Navy square #141A3C, off-white feather #F6F3EC, gold #E8B04A. Master: dasignature-icon.svg (in this folder).
Tasks: iOS icon set (1024 master, no transparency); Android adaptive (foreground feather+nib only, #141A3C background, safe-zone padding); PWA maskable 192/512; favicon SVG + 32 px PNG; desktop .ico/.icns/.png. Monochrome glyph (light/dark, Android themed). Horizontal lockup: icon left, wordmark 'DaSignature' Inter SemiBold with 'Da' regular, tight tracking. Flat: no gradients, shadows, glows.

## 12. Milestones
1 Scaffolding (monorepo, lint, TS strict, tokens, theming, CI, empty shells). 2 Storage (adapters, migrations, encryption, contract tests, backup format). 3 PDF viewer (worker rendering, virtualized pages, thumbnails, zoom, password PDFs). 4 Signature Studio (pen engine, 4 modes, presets, saved). 5 Placement editor (drag/resize/rotate, fields, snapping, undo/redo, autosave). 6 Export (flattened, audit page, integrity check, share/save). 7 Security and settings (app lock, biometrics, backup/restore, i18n, a11y pass). 8 Platform shells (PWA offline, Capacitor share target/file open, Tauri file association/menus). 9 Polish (perf budget, animation, empty states, onboarding, logo assets). 10 OSS release (README, CONTRIBUTING, SECURITY.md, privacy.md, Apache-2.0, third-party notices, screenshots, release workflows).

## 13. Acceptance Criteria
1. Import 20-page PDF, draw signature, place on page 3, resize, rotate, export <name>-signed.pdf opening correctly in Acrobat, Preview, Chrome; crisp at 800%.
2. Pen weight/thinness/color/opacity changes update live preview instantly; exported opacity matches with no darker overlaps.
3. Original PDF bytes unchanged after any edits/exports.
4. Airplane mode: after first load whole flow works offline; network monitor shows zero outbound requests.
5. Data survives restart; backup on one platform restores on another.
6. Visual checks at 320/390/768/1024/1440/2560 px, light+dark, portrait+landscape.
7. 60 fps pen on mid-range Android; 50 MB PDF opens without freezing.
8. App lock with biometrics on iOS, Android, desktop; encrypted data unreadable raw.
9. Axe: no critical issues; full keyboard on desktop; screen reader on mobile.
10. Bundle/installer budgets met and enforced in CI.
11. CI builds web, Android (APK/AAB), iOS (sim), desktop (Win/mac/Linux) on release tags; unit, adapter-contract, e2e tests pass.
12. Apache-2.0, third-party notices (OFL fonts), contribution guide, privacy statement.

## 14. Hosting Notes (owner)
Deploy apps/web to static host with CSP, Referrer-Policy, nosniff, long-cache hashed assets, no-cache index.html and SW. Native/desktop built by CI, published via App Store, Google Play, GitHub Releases. Apple paid dev account needed; confirm trademark for DaSignature before launch.
