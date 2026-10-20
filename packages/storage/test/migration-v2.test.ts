/**
 * Migration 2 (PM #71): legacy `<id>.<ext>` files are renamed to opaque `<id>` and every ref is
 * updated, crash-safely. Covers migrate-from-every-prior-version (v0 and v1) and a crash at every
 * side-effecting step, each followed by a "relaunch" that must converge with no orphan and no
 * lost file.
 */
import { describe, expect, it } from 'vitest';
import { MemoryBackend, MemoryStorageAdapter } from '../src/adapters/memory.ts';
import { bytesEqual } from '../src/bytes.ts';
import { DataStore } from '../src/datastore.ts';
import { FILE_COLUMNS } from '../src/fields.ts';
import { migrate, PENDING_FILE_DELETES, SCHEMA_VERSION, schemaVersion } from '../src/schema.ts';
import type { StorageAdapter } from '../src/types.ts';
import { newVault, seed } from './helpers.ts';

const LEGACY_EXT: Record<string, string> = { documents: 'pdf', exports: 'pdf', signatures: 'png' };
const refCols = Object.entries(FILE_COLUMNS).flatMap(([t, cs]) => cs.map((c) => [t, c] as const));

const open = async (backend: MemoryBackend) => {
  const db = new MemoryStorageAdapter(backend, { lockTimeoutMs: 2000 });
  await db.init({});
  return db;
};

async function refs(db: StorageAdapter): Promise<string[]> {
  const out: string[] = [];
  for (const [t, c] of refCols)
    for (const r of await db.query<{ v: string | null }>(`SELECT ${c} AS v FROM ${t}`))
      if (r.v) out.push(r.v);
  return out.sort();
}

/** A real v1 store: seeded data, files named `<id>.pdf` / `<id>.png`, schema at version 1. */
async function legacyStore() {
  const backend = new MemoryBackend();
  const vault = await newVault();
  const db = await open(backend);
  const store = await DataStore.open(db, vault);
  await seed(store);
  for (const [t, c] of refCols) {
    for (const r of await db.query<{ id: string; v: string | null }>(
      `SELECT id, ${c} AS v FROM ${t}`,
    )) {
      if (!r.v) continue;
      const legacy = `${r.v}.${LEGACY_EXT[t] ?? 'bin'}`;
      backend.files.set(legacy, backend.files.get(r.v) as Uint8Array);
      backend.files.delete(r.v);
      await db.exec(`UPDATE ${t} SET ${c} = ? WHERE id = ?`, [legacy, r.id]);
    }
  }
  // A row whose legacy file was already missing before the migration (must not block it).
  await db.exec(
    "INSERT INTO signatures (id, kind, source, name, image_ref, created_at) VALUES ('0190a000-0000-7000-8000-0000000000dd', 'signature', 'image', 'x', '0190a000-0000-7000-8000-0000000000ee.png', '2026-10-19T00:00:00Z')",
  );
  await db.exec('DELETE FROM schema_migrations WHERE version >= 2');
  await db.close();
  return { backend, vault };
}

/** Every file's sealed bytes keyed by the row that owns it (the ref may change, the bytes not). */
async function contentsByRow(backend: MemoryBackend): Promise<Map<string, Uint8Array | null>> {
  const db = await open(backend);
  const out = new Map<string, Uint8Array | null>();
  for (const [t, c] of refCols)
    for (const r of await db.query<{ id: string; v: string | null }>(
      `SELECT id, ${c} AS v FROM ${t}`,
    ))
      if (r.v) out.set(`${t}/${r.id}`, backend.files.get(r.v) ?? null);
  await db.close();
  return out;
}

/** Fails the n-th side-effecting call (file write/delete, SQL write, COMMIT) like a killed process. */
function crashing(db: StorageAdapter, n: number): { db: StorageAdapter; steps: () => number } {
  let left = n;
  let steps = 0;
  const tick = () => {
    steps++;
    if (left-- === 0) throw new Error('simulated crash');
  };
  const wrap = (a: StorageAdapter): StorageAdapter => ({
    init: (o) => a.init(o),
    close: () => a.close(),
    query: (sql, p) => a.query(sql, p),
    exec: async (sql, p) => {
      tick();
      await a.exec(sql, p);
    },
    transaction: (fn) =>
      a.transaction(async (tx) => {
        const r = await fn(wrap(tx));
        tick(); // crash just before COMMIT
        return r;
      }),
    putFile: (b, h) => a.putFile(b, h),
    putFileAt: async (ref, b) => {
      tick();
      await a.putFileAt(ref, b);
    },
    getFile: (ref) => a.getFile(ref),
    deleteFile: async (ref) => {
      tick();
      await a.deleteFile(ref);
    },
    usage: () => a.usage(),
  });
  return { db: wrap(db), steps: () => steps };
}

async function assertConverged(
  backend: MemoryBackend,
  before: Map<string, Uint8Array | null>,
  vault: Awaited<ReturnType<typeof newVault>>,
) {
  const db = await open(backend);
  expect(await schemaVersion(db)).toBe(SCHEMA_VERSION);
  const live = await refs(db);
  for (const r of live) expect(r, 'PM #71: opaque ref').toMatch(/^[0-9a-f-]{36}$/);
  // No orphans: the file store holds exactly the referenced files (the dangling ref has none).
  const stored = [...backend.files.keys()].sort();
  expect(stored).toEqual(live.filter((r) => backend.files.has(r)));
  expect(stored.filter((k) => k.includes('.'))).toEqual([]);
  // Nothing lost: every row's sealed bytes are unchanged and still decrypt.
  const after = await contentsByRow(backend);
  for (const [k, v] of before) {
    const now = after.get(k) ?? null;
    if (v === null) expect(now).toBeNull();
    else expect(now && bytesEqual(now, v), k).toBe(true);
  }
  expect(
    await db.query('SELECT 1 FROM settings WHERE key = ?', [PENDING_FILE_DELETES]),
  ).toHaveLength(0);
  const store = await DataStore.open(db, vault);
  const [doc] = await store.listDocuments();
  expect(doc && new TextDecoder().decode(await store.getDocumentPdf(doc))).toMatch(/^%PDF-/);
  await db.close();
}

describe('migration 2: opaque file refs (PM #71)', () => {
  it('from v0 (empty database) to the latest version', async () => {
    const db = new MemoryStorageAdapter();
    await db.init({});
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await schemaVersion(db)).toBe(2);
    await db.close();
  });

  it('from v1: renames <id>.pdf / <id>.png, updates refs, deletes the old names', async () => {
    const { backend, vault } = await legacyStore();
    expect([...backend.files.keys()].every((k) => /\.(pdf|png)$/.test(k))).toBe(true);
    const before = await contentsByRow(backend);
    const db = await open(backend);
    expect(await schemaVersion(db)).toBe(1);
    expect(await migrate(db)).toBe(2);
    await db.close();
    await assertConverged(backend, before, vault);
  });

  it('crash at every step, then relaunch: converges with no orphans and no lost files', async () => {
    // Count the side-effecting steps of a clean run first.
    const probe = await legacyStore();
    const pdb = await open(probe.backend);
    const counter = crashing(pdb, Number.POSITIVE_INFINITY);
    await migrate(counter.db);
    await pdb.close();
    const total = counter.steps();
    expect(total).toBeGreaterThan(8);

    for (let n = 0; n < total; n++) {
      const { backend, vault } = await legacyStore();
      const before = await contentsByRow(backend);
      const db = await open(backend);
      await expect(migrate(crashing(db, n).db), `crash at step ${String(n)}`).rejects.toThrow(
        'simulated crash',
      );
      await db.close(); // whatever was committed survives; an open transaction rolled back
      // Invariant at the crash point: every row still points at an existing, unchanged file.
      const mid = await contentsByRow(backend);
      for (const [k, v] of before)
        if (v)
          expect(
            mid.get(k) && bytesEqual(mid.get(k) as Uint8Array, v),
            `step ${String(n)} ${k}`,
          ).toBe(true);
      // Relaunch.
      const again = await open(backend);
      await migrate(again);
      await again.close();
      await assertConverged(backend, before, vault);
    }
  });
});
