# DaSignature

A private, local-first, open-source PDF signing app for web (PWA), iOS, Android, Windows, macOS
and Linux, from one TypeScript codebase. Your files never leave your device.

> Status: Milestone 1 (scaffolding). Not usable yet.

## Develop

Requires Node 20.19+ and pnpm 10.

```sh
pnpm install
pnpm dev         # web app at http://localhost:5173
pnpm lint        # ESLint + Prettier
pnpm typecheck   # strict TypeScript in every package
pnpm test        # Vitest in every package
pnpm build       # production web build (apps/web/dist)
pnpm size        # web initial-JS budget (< 250 KiB gzip)
pnpm test:e2e    # Playwright on the production build (run `pnpm build` first)
pnpm check:licenses && pnpm check:audit
```

`pnpm lint` also needs `python3` (the Designer's token build and contrast check, no packages).

Desktop (Tauri 2) needs Rust and the platform WebView dependencies:
`pnpm --filter @dasignature/desktop dev`.

## Layout

```
apps/web       Vite + React PWA (shared frontend for every platform)
apps/mobile    Capacitor shell (iOS/Android)
apps/desktop   Tauri 2 shell (src-tauri)
packages/core  services, types, pen engine, export
packages/ui    design system, tokens, theming, Tailwind preset
packages/storage  storage adapters and migrations
packages/pdf   PDF worker wrappers
packages/i18n  locales and RTL
docs/          decisions.md, ui-conventions.md, SPEC.md (owner's spec)
assets/        logo and brand assets (Designer pack)
```

## License

Apache-2.0. See [LICENSE](LICENSE).
