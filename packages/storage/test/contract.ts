/**
 * ADP-01: the StorageAdapter contract. Every class that `implements StorageAdapter` must be run
 * through runStorageContract (test/registry.test.ts enforces that by grepping the sources).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { bytesEqual, randomBytes, sha256Hex } from '../src/bytes.ts';
import { FileNotFoundError, StorageBusyError, StorageClosedError } from '../src/errors.ts';
import { migrate } from '../src/schema.ts';
import type { StorageAdapter } from '../src/types.ts';

export interface ContractTarget {
  /** A new adapter instance over this target's store; call again after close() to "reopen". */
  create(opts: { lockTimeoutMs: number }): StorageAdapter | Promise<StorageAdapter>;
  /** Removes everything the target stored (runs after each test). */
  destroy?(): Promise<void>;
  /** Key passed to init (SQLCipher key on native; ignored on web, where encryption is per field). */
  key?: CryptoKey | string;
  /** Include the 50 MB file case (default true). */
  largeFiles?: boolean;
}

const LOCK_MS = 300;
const NOW = '2026-10-19T00:00:00.000Z';

export function runStorageContract(name: string, target: () => ContractTarget): void {
  describe(`StorageAdapter contract: ${name}`, () => {
    let t: ContractTarget | undefined;
    const large = target().largeFiles !== false;
    const open: StorageAdapter[] = [];

    async function fresh(): Promise<StorageAdapter> {
      if (!t) throw new Error('setup() first');
      const a = await t.create({ lockTimeoutMs: LOCK_MS });
      open.push(a);
      await a.init(t.key === undefined ? {} : { key: t.key });
      await migrate(a, () => NOW);
      return a;
    }
    async function setup(): Promise<StorageAdapter> {
      t = target();
      return fresh();
    }
    const addDoc = (a: StorageAdapter, id: string, title = 'Doc') =>
      a.exec(
        'INSERT INTO documents (id, title, file_ref, sha256, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title, 'ref', 'hash', 1, NOW, NOW],
      );
    const count = async (a: StorageAdapter, table: string) =>
      (await a.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0]?.n;

    afterEach(async () => {
      for (const a of open.splice(0)) await a.close().catch(() => undefined);
      await t?.destroy?.();
      t = undefined;
    });

    it('init is idempotent, with and without a key', async () => {
      const a = await setup();
      await a.init({});
      await a.init({ key: t?.key ?? 'another-key' });
      await addDoc(a, 'd1');
      await a.init({});
      expect(await count(a, 'documents')).toBe(1);
      expect(await migrate(a)).toBe(1); // re-running migrations is a no-op
      expect(await count(a, 'schema_migrations')).toBe(1);
    });

    it('binds parameters (no SQL injection through values)', async () => {
      const a = await setup();
      const evil = "x'); DROP TABLE documents; --";
      await addDoc(a, 'd1', evil);
      const rows = await a.query<{ title: string }>('SELECT title FROM documents WHERE id = ?', [
        'd1',
      ]);
      expect(rows).toEqual([{ title: evil }]);
      expect(await a.query('SELECT id FROM documents WHERE id = ?', ["' OR 1=1 --"])).toEqual([]);
      expect(await count(a, 'documents')).toBe(1);
    });

    it('round-trips SQLite value types', async () => {
      const a = await setup();
      await a.exec('CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB, n TEXT)');
      const blob = new Uint8Array([0, 1, 2, 254, 255]);
      await a.exec('INSERT INTO t VALUES (?, ?, ?, ?, ?)', [42, 1.5, 'héllo ✍', blob, null]);
      const [row] = await a.query<{ i: number; r: number; s: string; b: Uint8Array; n: null }>(
        'SELECT * FROM t',
      );
      expect(row?.i).toBe(42);
      expect(row?.r).toBe(1.5);
      expect(row?.s).toBe('héllo ✍');
      expect(row?.n).toBeNull();
      expect(row && bytesEqual(new Uint8Array(row.b), blob)).toBe(true);
    });

    it('transaction commits on success', async () => {
      const a = await setup();
      const r = await a.transaction(async (tx) => {
        await addDoc(tx, 'd1');
        await addDoc(tx, 'd2');
        return 'done';
      });
      expect(r).toBe('done');
      expect(await count(a, 'documents')).toBe(2);
    });

    it('transaction rolls back when fn throws, and rethrows', async () => {
      const a = await setup();
      await addDoc(a, 'keep');
      await expect(
        a.transaction(async (tx) => {
          await addDoc(tx, 'd1');
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await a.query('SELECT id FROM documents')).toEqual([{ id: 'keep' }]);
      // A failing statement also rolls back the whole transaction.
      await expect(
        a.transaction(async (tx) => {
          await addDoc(tx, 'd2');
          await addDoc(tx, 'keep'); // primary key violation
        }),
      ).rejects.toThrow();
      expect(await count(a, 'documents')).toBe(1);
    });

    it('serializes concurrent transactions', async () => {
      const a = await setup();
      await a.exec("INSERT INTO settings (key, value) VALUES ('n', '0')");
      const log: string[] = [];
      const bump = (tag: string) =>
        a.transaction(async (tx) => {
          log.push(`${tag}:start`);
          const [r] = await tx.query<{ value: string }>(
            "SELECT value FROM settings WHERE key = 'n'",
          );
          await new Promise((res) => setTimeout(res, 20));
          await tx.exec("UPDATE settings SET value = ? WHERE key = 'n'", [
            String(Number(r?.value) + 1),
          ]);
          log.push(`${tag}:end`);
        });
      // A plain call issued meanwhile waits for the running transaction, too.
      await Promise.all([
        bump('a'),
        bump('b'),
        a.exec("UPDATE settings SET value = value || '' WHERE key = 'n'"),
        bump('c'),
      ]);
      expect(await a.query("SELECT value FROM settings WHERE key = 'n'")).toEqual([{ value: '3' }]);
      expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    });

    it('nested tx.transaction joins the outer one (savepoint)', async () => {
      const a = await setup();
      await a.transaction(async (tx) => {
        await addDoc(tx, 'outer');
        await tx.transaction(async (inner) => addDoc(inner, 'inner'));
        await tx
          .transaction(async (inner) => {
            await addDoc(inner, 'undone');
            throw new Error('inner fails');
          })
          .catch(() => undefined);
      });
      expect(
        (await a.query<{ id: string }>('SELECT id FROM documents ORDER BY id')).map((r) => r.id),
      ).toEqual(['inner', 'outer']);
      // Outer rollback also undoes the joined inner work.
      await a
        .transaction(async (tx) => {
          await tx.transaction(async (inner) => addDoc(inner, 'gone'));
          throw new Error('outer fails');
        })
        .catch(() => undefined);
      expect(await count(a, 'documents')).toBe(2);
    });

    it('rejects (does not deadlock) when fn calls the outer adapter', async () => {
      const a = await setup();
      await expect(a.transaction(async () => addDoc(a, 'wrong'))).rejects.toBeInstanceOf(
        StorageBusyError,
      );
      expect(await count(a, 'documents')).toBe(0);
      await addDoc(a, 'after'); // adapter still usable
      expect(await count(a, 'documents')).toBe(1);
    });

    it('invalidates the tx handle after the transaction', async () => {
      const a = await setup();
      let leaked: StorageAdapter | undefined;
      await a.transaction(async (tx) => {
        leaked = tx;
        await Promise.resolve();
      });
      await expect(leaked?.query('SELECT 1') ?? Promise.resolve()).rejects.toBeInstanceOf(
        StorageClosedError,
      );
    });

    const sizes: [string, number][] = [
      ['0 B', 0],
      ['1 B', 1],
      ['1 MB', 1024 * 1024],
    ];
    it.each(sizes)('putFile/getFile are byte-identical (%s)', async (_label, size) => {
      const a = await setup();
      const bytes = randomBytes(size);
      const ref = await a.putFile(bytes, 'contract.pdf');
      expect(ref).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(bytesEqual(await a.getFile(ref), bytes)).toBe(true);
    });

    it.skipIf(!large)(
      'putFile/getFile are byte-identical (50 MB)',
      async () => {
        const a = await setup();
        const bytes = randomBytes(50 * 1024 * 1024);
        const ref = await a.putFile(bytes);
        expect(await sha256Hex(await a.getFile(ref))).toBe(await sha256Hex(bytes));
      },
      120_000,
    );

    it('getFile rejects after deleteFile, and for unknown refs', async () => {
      const a = await setup();
      const ref = await a.putFile(new Uint8Array([1, 2, 3]));
      await a.deleteFile(ref);
      await expect(a.getFile(ref)).rejects.toBeInstanceOf(FileNotFoundError);
      await expect(a.getFile('018f0000-0000-7000-8000-000000000000')).rejects.toBeInstanceOf(
        FileNotFoundError,
      );
      await expect(a.getFile('../../etc/passwd')).rejects.toThrow(/invalid file ref/);
    });

    it('usage().used is >= 0 and grows after putFile', async () => {
      const a = await setup();
      const before = await a.usage();
      expect(before.used).toBeGreaterThanOrEqual(0);
      await a.putFile(randomBytes(256 * 1024));
      expect((await a.usage()).used).toBeGreaterThan(before.used);
    });

    it('data and files persist across close and reopen', async () => {
      const a = await setup();
      await addDoc(a, 'd1', 'Persisted');
      const bytes = randomBytes(4096);
      const ref = await a.putFile(bytes, 'x.bin');
      await a.close();
      await expect(a.query('SELECT 1')).rejects.toBeInstanceOf(StorageClosedError);
      const b = await fresh();
      expect(await b.query('SELECT title FROM documents')).toEqual([{ title: 'Persisted' }]);
      expect(bytesEqual(await b.getFile(ref), bytes)).toBe(true);
      expect(await count(b, 'schema_migrations')).toBe(1);
    });

    it('enforces ON DELETE CASCADE and ON DELETE SET NULL', async () => {
      const a = await setup();
      await addDoc(a, 'd1');
      await a.exec(
        "INSERT INTO signatures (id, kind, source, name, created_at) VALUES ('s1', 'signature', 'draw', 'Me', ?)",
        [NOW],
      );
      await a.exec(
        "INSERT INTO placements (id, document_id, page_index, type, signature_id, x, y, w, h) VALUES ('p1', 'd1', 0, 'signature', 's1', 0, 0, 1, 1)",
      );
      await a.exec(
        "INSERT INTO exports (id, document_id, file_ref, sha256, created_at) VALUES ('e1', 'd1', 'r', 'h', ?)",
        [NOW],
      );
      await a.exec("DELETE FROM signatures WHERE id = 's1'");
      expect(await a.query('SELECT signature_id FROM placements')).toEqual([
        { signature_id: null },
      ]);
      await a.exec("DELETE FROM documents WHERE id = 'd1'");
      expect(await count(a, 'placements')).toBe(0);
      expect(await count(a, 'exports')).toBe(0);
      await expect(
        a.exec(
          "INSERT INTO placements (id, document_id, page_index, type, x, y, w, h) VALUES ('p2', 'missing', 0, 't', 0, 0, 1, 1)",
        ),
      ).rejects.toThrow(/FOREIGN KEY/i);
    });
  });
}
