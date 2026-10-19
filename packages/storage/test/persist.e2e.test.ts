/**
 * PERSIST-01 (web): data survives a full browser relaunch (Playwright launchPersistentContext).
 * ENC-02 (web, on disk): the browser profile's OPFS and IndexedDB files hold no plaintext.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 4174;
const URL_ = `http://127.0.0.1:${String(PORT)}/`;
const TITLE = 'Relaunch Survives ' + 'QX9';
const PDF_MARKER = 'PdfBody' + 'QX9marker';

let server: ViteDevServer;
const profile = mkdtempSync(join(tmpdir(), 'dasig-persist-'));

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../harness', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: PORT,
      strictPort: true,
      fs: {
        allow: [
          fileURLToPath(new URL('..', import.meta.url)),
          fileURLToPath(new URL('../../../node_modules', import.meta.url)),
        ],
      },
    },
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    worker: { format: 'es' },
    logLevel: 'error',
  });
  await server.listen();
});
afterAll(async () => {
  await server.close();
  rmSync(profile, { recursive: true, force: true });
});

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, { headless: true });
}
async function ready(ctx: BrowserContext) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL_);
  await page.waitForFunction(() => document.title === 'ready');
  return page;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const s = statSync(p, { throwIfNoEntry: false });
    if (!s) return [];
    return s.isDirectory() ? filesUnder(p) : [p];
  });
}

describe('PERSIST-01 / ENC-02 / ENC-C07 in a real Chromium profile', () => {
  it('survives browser relaunch, and the profile holds no plaintext', async () => {
    const c1 = await launch();
    const written = await (
      await ready(c1)
    ).evaluate(
      ([t, m]) =>
        (
          window as unknown as {
            harness: { write(a: string, b: string): Promise<{ id: string; sha256: string }> };
          }
        ).harness.write(t, m),
      [TITLE, PDF_MARKER] as const,
    );
    await c1.close();

    const c2 = await launch();
    const page2 = await ready(c2);
    const keyHex = await page2.evaluate(() =>
      (window as unknown as { harness: { dataKeyHex(): Promise<string> } }).harness.dataKeyHex(),
    );
    const read = await page2.evaluate(() =>
      (
        window as unknown as {
          harness: {
            read(): Promise<{
              docs: { id: string; title: string; sha256: string }[];
              signer: string;
            }>;
          };
        }
      ).harness.read(),
    );
    await c2.close();
    expect(read.docs).toEqual([{ id: written.id, title: TITLE, sha256: written.sha256 }]);
    expect(read.signer).toBe(TITLE);

    // ENC-02 on disk: scan the storage areas of the profile (OPFS lives under "File System").
    const all = filesUnder(profile);
    const storage = all.filter((f) => /File System|IndexedDB/.test(f));
    expect(storage.length).toBeGreaterThan(0);
    const totalBytes = storage.reduce((s, f) => s + statSync(f).size, 0);
    expect(totalBytes).toBeGreaterThan(8192);
    const hits = storage.filter((f) => {
      const b = readFileSync(f);
      return [TITLE, PDF_MARKER, '%PDF'].some((m) => b.includes(Buffer.from(m)));
    });
    expect(hits).toEqual([]);
    // The data key is not on disk anywhere in the profile (raw, hex, base64).
    const key = Buffer.from(keyHex, 'hex');
    expect(key.length).toBe(32);
    const keyForms = [
      key,
      Buffer.from(keyHex),
      Buffer.from(key.toString('base64').replace(/=+$/, '')),
    ];
    const keyHits = all.filter((f) => {
      const b = readFileSync(f);
      return keyForms.some((k) => b.includes(k));
    });
    expect(keyHits).toEqual([]);
    // Positive control: the (plaintext, PM #17) schema is visible, so we did scan the real database.
    expect(
      storage.some((f) => readFileSync(f).includes(Buffer.from('CREATE TABLE documents'))),
    ).toBe(true);
  }, 120_000);
});
