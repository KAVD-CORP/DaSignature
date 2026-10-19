/**
 * Test-only: a TauriInvoke that drives the REAL desktop storage backend (rusqlite + SQLCipher,
 * apps/desktop/src-tauri/src/storage.rs) through the `storage_ipc` cargo example over JSON lines.
 * Build it first: `pnpm --filter @dasignature/storage test:native` does that.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { TauriInvoke } from '../src/adapters/tauri.ts';

export const CRATE_DIR = fileURLToPath(
  new URL('../../../apps/desktop/src-tauri/', import.meta.url),
);
export const IPC_BIN = `${CRATE_DIR}target/debug/examples/storage_ipc${process.platform === 'win32' ? '.exe' : ''}`;

export interface NativeProcess {
  invoke: TauriInvoke;
  stop(): Promise<void>;
}

export function startNative(dataDir: string): NativeProcess {
  if (!existsSync(IPC_BIN))
    throw new Error(`${IPC_BIN} missing: run cargo build --example storage_ipc`);
  const child: ChildProcessWithoutNullStreams = spawn(IPC_BIN, [dataDir], { stdio: 'pipe' });
  const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  let next = 1;
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  createInterface({ input: child.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string };
    const p = pending.get(r.id);
    pending.delete(r.id);
    if (r.ok) p?.ok(r.result ?? null);
    else p?.fail(new Error(r.error ?? 'native error'));
  });
  const exited = new Promise<void>((resolve) =>
    child.on('exit', () => {
      for (const p of pending.values()) p.fail(new Error(`storage_ipc exited: ${stderr}`));
      pending.clear();
      resolve();
    }),
  );
  const invoke: TauriInvoke = (cmd, args = {}) =>
    new Promise((ok, fail) => {
      const id = next++;
      pending.set(id, { ok, fail });
      child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  return {
    invoke,
    stop: async () => {
      child.stdin.end();
      await exited;
    },
  };
}
