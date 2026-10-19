// ADP-01: StorageAdapter contract (SPEC Sec 6: "Adapter contract tests must run against every implementation").
// Usage (in packages/storage/test/<adapter>.contract.test.ts):
//   import { runStorageContract } from './contract.ts';
//   runStorageContract('web-opfs-sahpool', makeWebHarness());
// Every case id is stable (ADP-01-Cnn) so PM waivers and QA evidence can cite it. A skipped case is a FAIL unless waived.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AdapterHarness, ContractOptions, StorageAdapter } from './types.ts';
import { bytes, sha256hex } from './fixtures.ts';

const MiB = 1024 * 1024;
const QA_DDL = [
  'CREATE TABLE IF NOT EXISTS qa_t (id INTEGER PRIMARY KEY, s TEXT, n REAL, i INTEGER, b BLOB)',
  'CREATE TABLE IF NOT EXISTS qa_parent (id TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS qa_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES qa_parent(id) ON DELETE CASCADE, ref_id TEXT REFERENCES qa_parent(id) ON DELETE SET NULL)',
];

export function runStorageContract(name: string, h: AdapterHarness, opts: ContractOptions = {}): void {
  const timeout = opts.timeoutMs ?? 120_000;
  const waived = (id: string) => opts.waivers?.[id];
  const large = opts.largeFileBytes ?? 50 * MiB;
  if (large < 50 * MiB && !waived('ADP-01-C09-50MiB')) throw new Error(`ADP-01 ${name}: largeFileBytes < 50 MiB needs a PM waiver for ADP-01-C09-50MiB`);

  describe(`ADP-01 StorageAdapter contract: ${name}`, () => {
    let a: StorageAdapter;
    beforeEach(async () => { await h.destroy(); a = await h.open(); for (const s of QA_DDL) await a.exec(s); }, timeout);
    afterEach(async () => { await h.close(a); await h.destroy(); }, timeout);
    const count = async (t = 'qa_t') => (await a.query<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))[0]?.n;

    it('ADP-01-C01 init() is idempotent: a second init with the same opts keeps data and the adapter usable', async () => {
      await a.exec('INSERT INTO qa_t (id, s) VALUES (1, ?)', ['x']);
      await a.init(h.initOpts);
      expect(await a.query('SELECT s FROM qa_t WHERE id = 1')).toEqual([{ s: 'x' }]);
    }, timeout);

    it('ADP-01-C02 exec/query bind params and round-trip TEXT/INTEGER/REAL/NULL/BLOB exactly', async () => {
      const text = 'é ü ß · Привет · مرحبا · 日本語 · 😀 · \'quote\' "dq"';
      const blob = bytes(257, 7);
      await a.exec('INSERT INTO qa_t (id, s, n, i, b) VALUES (?, ?, ?, ?, ?)', [1, text, -0.125, Number.MAX_SAFE_INTEGER, blob]);
      await a.exec('INSERT INTO qa_t (id, s, n, i, b) VALUES (?, ?, ?, ?, ?)', [2, '', 0, 0, null]);
      const rows = await a.query<{ id: number; s: string; n: number; i: number; b: Uint8Array | null }>('SELECT * FROM qa_t ORDER BY id');
      expect(rows.length).toBe(2);
      expect(rows[0]?.s).toBe(text); expect(rows[0]?.n).toBe(-0.125); expect(Number(rows[0]?.i)).toBe(Number.MAX_SAFE_INTEGER);
      expect(rows[0]?.b instanceof Uint8Array).toBe(true); expect([...(rows[0]?.b ?? [])]).toEqual([...blob]);
      expect(rows[1]).toEqual({ id: 2, s: '', n: 0, i: 0, b: null });
    }, timeout);

    it('ADP-01-C03 params are never interpolated (SQL injection via a param is stored literally)', async () => {
      const evil = "x'); DROP TABLE qa_t; --";
      await a.exec('INSERT INTO qa_t (id, s) VALUES (?, ?)', [1, evil]);
      expect(await a.query('SELECT s FROM qa_t')).toEqual([{ s: evil }]);
      expect(await a.query("SELECT name FROM sqlite_master WHERE name = 'qa_t'")).toHaveLength(1);
    }, timeout);

    it('ADP-01-C04 query returns [] for no rows and plain objects keyed by column name', async () => {
      expect(await a.query('SELECT * FROM qa_t')).toEqual([]);
      await a.exec('INSERT INTO qa_t (id, s) VALUES (1, ?)', ['v']);
      const [r] = await a.query<Record<string, unknown>>('SELECT id AS the_id, s AS the_s FROM qa_t');
      expect(Object.keys(r ?? {}).sort()).toEqual(['the_id', 'the_s']);
    }, timeout);

    it('ADP-01-C05 transaction commits on resolve and returns fn\'s value', async () => {
      const v = await a.transaction(async (tx) => { const t = tx ?? a; await t.exec('INSERT INTO qa_t (id) VALUES (1)'); await t.exec('INSERT INTO qa_t (id) VALUES (2)'); return 42; });
      expect(v).toBe(42); expect(await count()).toBe(2);
    }, timeout);

    it('ADP-01-C06 transaction rolls back every write when fn throws, and rejects with that error', async () => {
      await a.exec('INSERT INTO qa_t (id) VALUES (1)');
      const boom = new Error('qa-boom');
      await expect(a.transaction(async (tx) => { const t = tx ?? a; await t.exec('INSERT INTO qa_t (id) VALUES (2)'); await t.exec('UPDATE qa_t SET s = ?', ['dirty']); throw boom; })).rejects.toBe(boom);
      expect(await a.query('SELECT id, s FROM qa_t')).toEqual([{ id: 1, s: null }]);
    }, timeout);

    it('ADP-01-C07 concurrent transaction() calls are serialized: no interleaving, no lost updates', async () => {
      await a.exec('INSERT INTO qa_t (id, i) VALUES (1, 0)');
      const log: string[] = []; const N = 20;
      const worker = (tag: string) => a.transaction(async (tx) => {
        const t = tx ?? a; log.push(`${tag}:start`);
        for (let k = 0; k < N; k++) {
          const [r] = await t.query<{ i: number }>('SELECT i FROM qa_t WHERE id = 1');
          await new Promise((res) => setTimeout(res, 0));
          await t.exec('UPDATE qa_t SET i = ? WHERE id = 1', [Number(r?.i) + 1]);
        }
        log.push(`${tag}:end`);
      });
      await Promise.all([worker('A'), worker('B'), worker('C')]);
      expect(Number((await a.query<{ i: number }>('SELECT i FROM qa_t WHERE id = 1'))[0]?.i)).toBe(3 * N);
      for (let k = 0; k < log.length; k += 2) expect(log[k]?.split(':')[0]).toBe(log[k + 1]?.split(':')[0]); // start/end pairs adjacent
    }, timeout);

    it('ADP-01-C08 nested transaction either joins the outer one (rolled back with it) or rejects; never commits alone', async () => {
      let nestedRejected = false;
      await expect(a.transaction(async (tx) => {
        const t = tx ?? a;
        try { await t.transaction(async (tx2) => { await (tx2 ?? t).exec('INSERT INTO qa_t (id) VALUES (10)'); }); } catch { nestedRejected = true; }
        throw new Error('qa-outer');
      })).rejects.toThrow('qa-outer');
      expect(await count()).toBe(0); // joined -> rolled back with outer; rejected -> never written
      // record the behaviour so docs/decisions.md can be checked against it (QA rule, TEST_PLAN ADP-01)
      console.info(`[ADP-01-C08] ${name}: nested transaction ${nestedRejected ? 'REJECTS' : 'JOINS the outer transaction'}`);
    }, timeout);

    for (const [label, n] of [['0 B', 0], ['1 B', 1], ['1 MiB', MiB], [`${(large / MiB).toFixed(0)} MiB`, large]] as const) {
      it(`ADP-01-C09 putFile -> getFile is byte-identical (${label}); refs are non-empty strings`, async () => {
        const src = bytes(n, n + 3); const want = await sha256hex(src);
        const ref = await a.putFile(src, 'qa.bin');
        expect(typeof ref).toBe('string'); expect(ref.length).toBeGreaterThan(0);
        const got = await a.getFile(ref);
        expect(got.byteLength).toBe(n); expect(await sha256hex(got)).toBe(want);
      }, timeout);
    }

    it('ADP-01-C10 stored bytes are isolated from caller buffers (AC3: originals never change)', async () => {
      const src = bytes(4096, 11); const want = await sha256hex(src);
      const ref = await a.putFile(src);
      src.fill(0);                                   // caller mutates its buffer after putFile
      const got1 = await a.getFile(ref); expect(await sha256hex(got1)).toBe(want);
      got1.fill(0xff);                               // caller mutates the returned buffer
      expect(await sha256hex(await a.getFile(ref))).toBe(want);
    }, timeout);

    it('ADP-01-C11 two putFile calls never share a ref unless the bytes are identical; deleteFile removes only its file', async () => {
      const r1 = await a.putFile(bytes(100, 1)), r2 = await a.putFile(bytes(100, 2));
      expect(r1).not.toBe(r2);
      await a.deleteFile(r1);
      await expect(a.getFile(r1)).rejects.toBeTruthy();
      expect(await sha256hex(await a.getFile(r2))).toBe(await sha256hex(bytes(100, 2)));
      await expect(a.getFile('qa-never-existed')).rejects.toBeTruthy();
    }, timeout);

    it('ADP-01-C12 usage(): used is a finite number >= 0, grows after a 1 MiB putFile, quota (if any) >= used', async () => {
      const u0 = await a.usage(); expect(Number.isFinite(u0.used)).toBe(true); expect(u0.used).toBeGreaterThanOrEqual(0);
      await a.putFile(bytes(MiB, 5));
      const u1 = await a.usage(); expect(u1.used).toBeGreaterThan(u0.used);
      if (u1.quota !== undefined) expect(u1.quota).toBeGreaterThanOrEqual(u1.used);
    }, timeout);

    it('ADP-01-C13 rows and files survive close + reopen of the adapter (PERSIST-01, adapter level)', async () => {
      await a.exec('INSERT INTO qa_t (id, s) VALUES (1, ?)', ['persist']);
      const src = bytes(65536, 13); const ref = await a.putFile(src);
      await h.close(a); a = await h.open();
      expect(await a.query('SELECT s FROM qa_t')).toEqual([{ s: 'persist' }]);
      expect(await sha256hex(await a.getFile(ref))).toBe(await sha256hex(src));
    }, timeout);

    it('ADP-01-C14 foreign keys are ENFORCED (SQLite default is off): bad FK rejects, CASCADE and SET NULL fire', async () => {
      await expect(a.exec("INSERT INTO qa_child (id, parent_id) VALUES ('c0', 'missing')")).rejects.toBeTruthy();
      await a.exec("INSERT INTO qa_parent (id) VALUES ('p1'), ('p2')");
      await a.exec("INSERT INTO qa_child (id, parent_id, ref_id) VALUES ('c1', 'p1', 'p2')");
      await a.exec("DELETE FROM qa_parent WHERE id = 'p2'");
      expect(await a.query("SELECT ref_id FROM qa_child WHERE id = 'c1'")).toEqual([{ ref_id: null }]);
      await a.exec("DELETE FROM qa_parent WHERE id = 'p1'");
      expect(await count('qa_child')).toBe(0);
    }, timeout);

    it('ADP-01-C15 a failing statement rejects with an Error and leaves the adapter usable', async () => {
      await expect(a.exec('INSERT INTO qa_nope VALUES (1)')).rejects.toBeInstanceOf(Error);
      await expect(a.query('SELEC 1')).rejects.toBeInstanceOf(Error);
      await a.exec('INSERT INTO qa_t (id) VALUES (1)'); expect(await count()).toBe(1);
    }, timeout);

    it('ADP-01-C16 a rejected statement inside transaction() rolls the whole transaction back', async () => {
      await expect(a.transaction(async (tx) => { const t = tx ?? a; await t.exec('INSERT INTO qa_t (id) VALUES (1)'); await t.exec('INSERT INTO qa_t (id) VALUES (1)'); })).rejects.toBeTruthy();
      expect(await count()).toBe(0);
    }, timeout);
  });
}
