# Vendored QA gate scripts

Byte-identical copies of QA's self-contained checks from the team's `qa/scripts/` (QA owns them; do
not edit here, re-copy instead). Vendored so CI and a clean clone can run them without the QA tree.

- `check-contract-registration.mjs`: ADP-REG-01, every `implements StorageAdapter` class runs the
  contract suites (`pnpm check:contracts`).
- `check-render-headers.mjs`: RENDER-01, serves `apps/web/dist` with `render.yaml`'s headers and
  rewrites (`pnpm check:render`, after `pnpm build`).
- `check-dasig-manifest.mjs`: BAK-01-C11/C13 on a real `.dasig` file; run by
  `packages/storage/test/dasig-manifest.test.ts` against a freshly generated backup.
