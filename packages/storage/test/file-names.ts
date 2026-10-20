/**
 * PM #71 (QA-M2-01): nothing at rest reveals a file's type. After writing one of everything
 * (PDFs, exports, a PNG signature image) through the real services, every stored NAME and every
 * persisted BYTE is scanned for extensions and MIME strings. All user content is encrypted, so
 * there is no "encrypted metadata" exception to make: any hit is a leak.
 */
import { describe, expect, it } from 'vitest';
import { DataStore } from '../src/datastore.ts';
import { migrate } from '../src/schema.ts';
import { type Kit, writeFixtures } from './qa-harness.ts';
import { AppLock, WebKeyManager } from '../src/crypto/keys.ts';

export const TYPE_LEAKS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

function find(hay: Uint8Array, needle: string): string[] {
  const out: string[] = [];
  const forms: [string, Uint8Array][] = [
    ['utf8', new TextEncoder().encode(needle)],
    ['utf8-upper', new TextEncoder().encode(needle.toUpperCase())],
    [
      'utf16le',
      Uint8Array.from({ length: needle.length * 2 }, (_, i) =>
        i % 2 ? 0 : needle.charCodeAt(i / 2),
      ),
    ],
  ];
  for (const [enc, n] of forms) {
    outer: for (let i = 0; i + n.length <= hay.length; i++) {
      for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
      out.push(enc);
      break;
    }
  }
  return out;
}

export function runFileNameScan(name: string, kit: Kit): void {
  describe(`FILE-NAMES-01 (PM #71) no file type at rest: ${name}`, () => {
    it('stored names have no extension and no persisted byte names a type or MIME', async () => {
      await kit.wipe();
      const a = kit.adapter();
      await a.init(kit.initOpts);
      await migrate(a);
      const keys =
        kit.keys === 'web'
          ? await (async () => {
              if (!kit.kv) throw new Error('web kit needs kv');
              const lock = new AppLock(new WebKeyManager(kit.kv()));
              await lock.resume();
              return lock;
            })()
          : await kit.keys.vault();
      const store = await DataStore.open(a, keys);
      await writeFixtures(store, 'A');
      const refs = await a.query<{ r: string }>(
        'SELECT file_ref AS r FROM documents UNION ALL SELECT file_ref FROM exports UNION ALL SELECT image_ref FROM signatures WHERE image_ref IS NOT NULL',
      );
      expect(refs.length).toBeGreaterThanOrEqual(3);
      for (const { r } of refs) expect(r).toMatch(/^[0-9a-f-]{36}$/);
      await a.close();

      const raw = await kit.rawBytes();
      expect(raw.length).toBeGreaterThan(0);
      const nameHits = raw
        .map((f) => f.path)
        .filter((p) => /\.(pdf|png|jpe?g|gif|webp)$/i.test(p.split('/').pop() ?? ''));
      expect(nameHits, 'stored file names').toEqual([]);
      const byteHits: string[] = [];
      for (const f of raw)
        for (const n of TYPE_LEAKS)
          for (const e of find(f.bytes, n)) byteHits.push(`${n} (${e}) in ${f.path}`);
      expect(byteHits, 'persisted bytes').toEqual([]);
      await kit.wipe();
    }, 120_000);
  });
}
