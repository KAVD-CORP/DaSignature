# Contributing to DaSignature

Thanks for helping! DaSignature is Apache-2.0. By opening a pull request you agree that your
contribution is licensed under the same terms.

## Ground rules

- **Privacy is the product.** No network calls at runtime, no CDNs, no analytics, no remote fonts.
  Every asset is bundled and same-origin, and the e2e suite fails on any outbound request.
- **One codebase.** The UI never imports Tauri or Capacitor. Platform code lives behind the
  adapters in `packages/storage` and the bridges in `apps/web/src/services/native.ts`.
- **Accessible and localized.** New UI strings go into `packages/i18n/src/messages/en.ts`. New
  screens need keyboard support and pass the axe scan in e2e.
- **Small dependencies.** New runtime dependencies must use an allowlisted license
  (`pnpm check:licenses`) and stay within the size budgets (`pnpm size`).

## Workflow

1. `pnpm install`, then `pnpm dev`.
2. Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.
3. If you add or upgrade a dependency, run `pnpm notices`.
4. Explain user-visible changes in the PR. Record design decisions in `docs/decisions.md`.

## Reporting bugs

Open an issue with steps, platform and version. **Never attach a real signed document or your
signature.** Use a test PDF. For security problems, see [SECURITY.md](SECURITY.md).
