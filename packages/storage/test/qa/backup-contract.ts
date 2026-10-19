// BAK-01: .dasig backup format contract. SPEC Sec 6 "Backups (.dasig) always encrypted with user password"; Sec 10
// ".dasig = encrypted ZIP with JSON manifest, documented open format. Same data format on every platform".
// PM #66: the #18 KDF applies to the backup password, per-backup random salt. PM #67: plaintext manifest.json allowed with
// ONLY format version, app version, created_at, KDF id + params, salt, IV/nonce info, cipher id. PM #68: restore REPLACES
// all data, behind a destructive confirm. PM #69: newer schema refused with "update DaSignature", data untouched.
// Format-agnostic: every case goes through the Engineer's BackupService via the hooks below.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AdapterHarness, Snapshot, StorageAdapter } from './types.ts';
import { MARKERS, fixturePdf, sha256hex, findText, indexOf, ISO_WITH_OFFSET } from './fixtures.ts';
import { updateRequiredProblems, rawDiff, type RawFile, type UpdateRequiredSpec } from './checks.ts';

export interface BackupHarness {
  adapter: AdapterHarness;                                      // opens a migrated, unlocked, EMPTY store
  writeFixtures(a: StorageAdapter, variant: 'A' | 'B'): Promise<void>; // two distinct data sets via the real services (A uses MARKERS + fixturePdf())
  snapshot(a: StorageAdapter): Promise<Snapshot>;               // decrypted logical view: all rows + sha256 of every stored file
  createBackup(a: StorageAdapter, password: string): Promise<Uint8Array>;
  /** PM #68: the product's restore entry point (the one the UI calls). It must consult `confirm` (the destructive confirm
   *  sheet) exactly once BEFORE writing anything; `false` = cancelled: resolve or reject, but change nothing. */
  restoreBackup(a: StorageAdapter, dasig: Uint8Array, password: string, confirm: () => Promise<boolean>): Promise<unknown>;
  /** PM #67: the manifest bytes exactly as stored in plaintext (e.g. unzip(dasig)['manifest.json']) and the encrypted rest. */
  splitBackup(dasig: Uint8Array): { manifest: Uint8Array; payload: Uint8Array };
  /** Re-encode a backup with a patched manifest, re-encrypting correctly (tests version handling, not crypto). */
  rewriteManifest(dasig: Uint8Array, password: string, patch: (m: Record<string, unknown>) => Record<string, unknown>): Promise<Uint8Array>;
  /** Re-encode a backup whose DATA schema version is `v` (inside the encrypted payload per PM #67). */
  withSchemaVersion(dasig: Uint8Array, password: string, v: number): Promise<Uint8Array>;
  /** Manifest field holding the format version (default "formatVersion"), the version this build writes, and its data schema version. */
  versionField?: string; currentVersion: number; currentSchemaVersion: number;
  /** PM #66/#18: the declared KDF of a manifest, including its salt (string or bytes). */
  manifestKdf: (m: Record<string, unknown>) => { alg: string; memoryKiB?: number; iterations: number; parallelism?: number; salt: string | Uint8Array };
  /** PM #69: dedicated error for a newer backup (format or data schema) and the message the user sees. */
  newerBackup: UpdateRequiredSpec;
  /** Every persisted byte of the store (byte-identity after refused/cancelled restores). */
  rawBytes(): Promise<RawFile[]>;
  /** Committed older-version backups (qa/fixtures/dasig/v<N>/) with their expected snapshots: they must keep restoring forever. */
  legacyFixtures?: () => Promise<{ version: number; dasig: Uint8Array; password: string; expected: Snapshot }[]>;
}
const PW = 'qa-backup-pässwörd-1';
/** C14: distinctive seed so a leaked count is detectable (a count of 1 or 2 would match anything). */
export const QA_SEED_PRESETS = 1237;

/** PM #67 allowlist, as flattened manifest key paths. Anything else fails BAK-01-C13. */
export const MANIFEST_ALLOWED: { item: string; path: RegExp }[] = [
  { item: 'format version', path: /^(formatVersion|format_version|version)$/ },
  { item: 'format version (format identifier; constant string, QA reading of "format version")', path: /^format$/ },
  { item: 'app version', path: /^(appVersion|app_version|app\.version)$/ },
  { item: 'created_at', path: /^(createdAt|created_at)$/ },
  { item: 'KDF id', path: /^(kdf|kdfId|kdf_id|kdf\.(id|alg|algorithm|name))$/ },
  { item: 'KDF params', path: /^(kdf|kdfParams)\.(memoryKiB|memory|m|iterations|t|parallelism|p|hash|prf|digest|keyLength|dkLen|hashLength|version)$/ },
  { item: 'salt', path: /^(salt|kdf\.salt|kdfParams\.salt)$/ },
  { item: 'IV/nonce info', path: /^((iv|nonce)s?(\.(\d+|length|bytes|size|prefix|base|scheme|mode))*|(iv|nonce)(Length|Bytes|Size|Prefix|Scheme|Mode))$/ },
  { item: 'cipher id', path: /^(cipher|cipherId|cipher_id)$/ },
];
const flatten = (v: unknown, pre = ''): [string, unknown][] =>
  v !== null && typeof v === 'object' && !(v instanceof Uint8Array)
    ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, pre ? `${pre}.${k}` : k))
    : [[pre, v]];
const b64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

export function runBackupContract(name: string, h: BackupHarness, timeout = 180_000): void {
  const vf = h.versionField ?? 'formatVersion';
  const yes = async () => true;
  describe(`BAK-01 .dasig contract: ${name}`, () => {
    let a: StorageAdapter;
    beforeEach(async () => { await h.adapter.destroy(); a = await h.adapter.open(); }, timeout);
    afterEach(async () => { await h.adapter.close(a); await h.adapter.destroy(); }, timeout);
    const fresh = async () => { await h.adapter.close(a); await h.adapter.destroy(); a = await h.adapter.open(); };
    const restore = (d: Uint8Array, pw = PW) => h.restoreBackup(a, d, pw, yes);
    const manifestOf = (d: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(h.splitBackup(d).manifest)) as Record<string, unknown>;
    /** Back up variant A, then put the store into state B (the "existing data" a failed restore must not touch). */
    const backupAThenStateB = async () => {
      await h.writeFixtures(a, 'A'); const sA = await h.snapshot(a); const dasig = await h.createBackup(a, PW);
      await fresh(); await h.writeFixtures(a, 'B'); return { dasig, sA, b: await h.snapshot(a) };
    };
    /** Run fn with the store closed before and after, returning the byte diff of every persisted file. */
    const rawAround = async (fn: () => Promise<void>) => {
      await h.adapter.close(a); const r0 = await h.rawBytes(); a = await h.adapter.open();
      await fn();
      await h.adapter.close(a); const r1 = await h.rawBytes(); a = await h.adapter.open();
      return rawDiff(r0, r1);
    };

    it('BAK-01-C01 round-trip: backup -> wipe -> restore gives identical rows and file hashes; the original PDF is byte-identical (AC3)', async () => {
      await h.writeFixtures(a, 'A'); const s0 = await h.snapshot(a);
      const dasig = await h.createBackup(a, PW);
      await fresh(); await restore(dasig);
      const s1 = await h.snapshot(a); expect(s1).toEqual(s0);
      const pdfHash = await sha256hex(fixturePdf());
      expect(s1.fileHashes).toContain(pdfHash);
      const docs = s1.tables['documents'] ?? []; expect(docs.some((d) => d['sha256'] === pdfHash)).toBe(true);
    }, timeout);

    it('BAK-01-C02 stable: restore -> backup again -> restore elsewhere is still identical (no drift across generations)', async () => {
      await h.writeFixtures(a, 'A'); const s0 = await h.snapshot(a);
      let dasig = await h.createBackup(a, PW);
      for (let gen = 0; gen < 2; gen++) { await fresh(); await restore(dasig); dasig = await h.createBackup(a, PW); }
      expect(await h.snapshot(a)).toEqual(s0);
    }, timeout);

    it('BAK-01-C03 empty store round-trips', async () => {
      const s0 = await h.snapshot(a); const dasig = await h.createBackup(a, PW);
      await fresh(); await restore(dasig); expect(await h.snapshot(a)).toEqual(s0);
    }, timeout);

    it('BAK-01-C04 wrong password rejects cleanly; existing data untouched (no partial restore)', async () => {
      const { dasig, b } = await backupAThenStateB();
      await expect(restore(dasig, 'wrong-password')).rejects.toBeTruthy();
      await expect(restore(dasig, '')).rejects.toBeTruthy();
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);

    it('BAK-01-C05 truncated input is rejected at every cut point; existing data untouched', async () => {
      const { dasig, b } = await backupAThenStateB(); const n = dasig.length;
      for (const cut of [...new Set([0, 1, 2, 4, 22, 64, n >> 1, n - 17, n - 16, n - 1])].filter((c) => c >= 0 && c < n))
        await expect(restore(dasig.slice(0, cut)), `cut at ${cut}/${n}`).rejects.toBeTruthy();
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);

    it('BAK-01-C06 corrupted input (single bit flips: header, body, last byte; appended junk; random bytes) is rejected; data untouched', async () => {
      const { dasig, b } = await backupAThenStateB(); const n = dasig.length;
      for (const pos of [...new Set([0, 3, 8, 30, n >> 2, n >> 1, (3 * n) >> 2, n - 1])]) {
        const c = dasig.slice(); c[pos] = (c[pos] ?? 0) ^ 0x10;
        await expect(restore(c), `bit flip at ${pos}/${n}`).rejects.toBeTruthy();
      }
      const junk = new Uint8Array(n + 7); junk.set(dasig); junk.set([1, 2, 3, 4, 5, 6, 7], n);
      await expect(restore(junk), 'appended junk').rejects.toBeTruthy();
      await expect(restore(crypto.getRandomValues(new Uint8Array(4096))), 'random bytes').rejects.toBeTruthy();
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);

    it('BAK-01-C07 versioning (PM #67 fields): integer format version = currentVersion, created_at ISO-8601+offset, app version string', async () => {
      await h.writeFixtures(a, 'A'); const m = manifestOf(await h.createBackup(a, PW)); const f = new Map(flatten(m));
      expect(m[vf]).toBe(h.currentVersion); expect(Number.isInteger(m[vf])).toBe(true);
      expect(String(f.get('createdAt') ?? f.get('created_at'))).toMatch(ISO_WITH_OFFSET);
      const appV = f.get('appVersion') ?? f.get('app_version') ?? f.get('app.version');
      expect(typeof appV === 'string' && appV.length > 0, 'manifest names the app version that wrote it').toBe(true);
    }, timeout);

    it('BAK-01-C08 (PM #69) a FUTURE format version is refused with the dedicated error + "update DaSignature"; storage byte-identical', async () => {
      const { dasig, b } = await backupAThenStateB();
      const future = await h.rewriteManifest(dasig, PW, (m) => ({ ...m, [vf]: h.currentVersion + 1 }));
      let err: unknown = null;
      expect(await rawAround(async () => { err = await restore(future).then(() => null, (e: unknown) => e); })).toEqual([]);
      expect(updateRequiredProblems(err, h.newerBackup)).toEqual([]);
      const garbage = await h.rewriteManifest(dasig, PW, (m) => ({ ...m, [vf]: 'x' }));
      await expect(restore(garbage)).rejects.toBeTruthy();
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);

    it('BAK-01-C09 raw .dasig bytes leak nothing: no marker strings (UTF-8/16), no %PDF-', async () => {
      await h.writeFixtures(a, 'A'); const d1 = await h.createBackup(a, PW);
      const hits = Object.entries(MARKERS).flatMap(([k, m]) => findText(d1, m).map((e) => `${k} (${e})`));
      expect(hits).toEqual([]);
      expect(indexOf(d1, new TextEncoder().encode('%PDF-'))).toBe(-1);
    }, timeout);

    it('BAK-01-C10 every committed legacy-version fixture still restores to its expected snapshot', async () => {
      const list = (await h.legacyFixtures?.()) ?? [];
      if (h.currentVersion > 1) expect(list.length, 'from format v2 on, qa/fixtures/dasig/v1.. must be committed').toBeGreaterThan(0);
      for (const f of list) { await fresh(); await restore(f.dasig, f.password); expect(await h.snapshot(a), `legacy v${f.version}`).toEqual(f.expected); }
    }, timeout);

    it('BAK-01-C11 (BAK-03, PM #66/#18) the manifest declares the #18 KDF: Argon2id m=65536 KiB t=3 p=1, or PBKDF2-SHA256 600,000; salt present', async () => {
      await h.writeFixtures(a, 'A'); const k = h.manifestKdf(manifestOf(await h.createBackup(a, PW)));
      if (k.alg === 'argon2id') expect({ m: k.memoryKiB, t: k.iterations, p: k.parallelism }).toEqual({ m: 65536, t: 3, p: 1 });
      else { expect(k.alg).toBe('pbkdf2-sha256'); expect(k.iterations).toBe(600_000); }
      expect(k.salt.length, 'non-empty salt').toBeGreaterThan(0);
    }, timeout);

    it('BAK-01-C12 (PM #66) per-backup random salt: two backups of the same data with the same password differ in salt AND ciphertext', async () => {
      await h.writeFixtures(a, 'A'); const d1 = await h.createBackup(a, PW), d2 = await h.createBackup(a, PW);
      const s = (d: Uint8Array) => { const x = h.manifestKdf(manifestOf(d)).salt; return typeof x === 'string' ? x : b64(x); };
      expect(s(d1), 'salt reused across backups').not.toBe(s(d2));
      const p1 = h.splitBackup(d1).payload, p2 = h.splitBackup(d2).payload;
      expect(p1.length).toBeGreaterThan(0);
      expect(await sha256hex(p1), 'identical ciphertext: the salt/IV is not actually used').not.toBe(await sha256hex(p2));
      const head = Math.min(64, p1.length, p2.length);
      expect(b64(p1.slice(0, head)), 'ciphertexts share their first bytes (fixed key/IV?)').not.toBe(b64(p2.slice(0, head)));
    }, timeout);

    it('BAK-01-C13 (PM #67) the plaintext manifest holds ONLY the allowed fields; any extra key fails', async () => {
      await h.writeFixtures(a, 'A'); const dA = await h.createBackup(a, PW);
      const m = manifestOf(dA); const leaves = flatten(m);
      const extra = leaves.filter(([p]) => !MANIFEST_ALLOWED.some((x) => x.path.test(p))).map(([p, v]) => `${p}=${JSON.stringify(v)}`);
      expect(extra, 'manifest keys not allowed by PM #67').toEqual([]);
      const have = (item: string) => leaves.some(([p]) => MANIFEST_ALLOWED.some((x) => x.item.startsWith(item) && x.path.test(p)));
      for (const req of ['format version', 'app version', 'created_at', 'KDF id', 'salt', 'cipher id']) expect(have(req), `required manifest field: ${req}`).toBe(true);
      const cipher = leaves.find(([p]) => /^(cipher|cipherId|cipher_id)$/.test(p))?.[1];
      expect(String(cipher)).toMatch(/^AES-?256-?GCM$/i);                                   // PM #18
      // the format identifier (if present) must be a constant, not data-derived
      await fresh(); const mEmpty = manifestOf(await h.createBackup(a, PW));
      expect(mEmpty['format']).toEqual(m['format']);
    }, timeout);

    it('BAK-01-C14 (PM #67) the manifest bytes contain no user content: titles, names, template names, ids, hashes, counts (distinctive seeds)', async () => {
      await h.writeFixtures(a, 'A');
      await a.transaction(async (tx) => { for (let i = 0; i < QA_SEED_PRESETS; i++) await (tx ?? a).exec('INSERT INTO pen_presets (id, name, settings_json) VALUES (?, ?, ?)', [`qa-seed-preset-${i}`, 'qa', '{}']); });
      const mb = h.splitBackup(await h.createBackup(a, PW)).manifest; const text = new TextDecoder().decode(mb);
      const leaks: string[] = [];
      for (const [k, v] of Object.entries(MARKERS)) {
        for (const e of findText(mb, v)) leaks.push(`marker ${k} (${e})`);
        if (text.includes(b64(new TextEncoder().encode(v)).replace(/=+$/, ''))) leaks.push(`marker ${k} (base64)`);
      }
      const hashes = [await sha256hex(fixturePdf()), ...(await a.query<{ h: string }>('SELECT sha256 AS h FROM documents UNION SELECT sha256 FROM exports')).map((r) => String(r.h))];
      for (const hx of new Set(hashes)) for (const [enc, s] of [['hex', hx], ['HEX', hx.toUpperCase()], ['base64', b64(unhex(hx)).replace(/=+$/, '')]] as const)
        if (text.includes(s)) leaks.push(`sha256 ${hx.slice(0, 12)}… (${enc})`);
      const ids = (await a.query<{ id: string }>('SELECT id FROM documents UNION SELECT id FROM signatures UNION SELECT id FROM templates UNION SELECT id FROM exports')).map((r) => String(r.id));
      for (const id of ids) if (text.includes(id)) leaks.push(`row id ${id}`);
      const counts: Record<string, number> = {};
      for (const t of ['documents', 'signatures', 'placements', 'exports', 'pen_presets', 'templates', 'settings'])
        counts[t] = Number((await a.query<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))[0]?.n);
      counts['(all rows)'] = Object.values(counts).reduce((x, y) => x + y, 0);
      expect(counts['pen_presets']).toBeGreaterThanOrEqual(QA_SEED_PRESETS);
      for (const [t, n] of Object.entries(counts)) if (n >= 100 && new RegExp(`(?<![0-9A-Za-z+/._-])${n}(?![0-9A-Za-z+/_-])`).test(text)) leaks.push(`count ${t}=${n}`);
      expect(leaks, `manifest: ${text.slice(0, 400)}`).toEqual([]);
    }, timeout);

    it('BAK-01-C15 (PM #68) restore REPLACES all data: afterwards the store equals the backup and no pre-existing record or file remains', async () => {
      const { dasig, sA } = await backupAThenStateB();
      const idTables = ['documents', 'signatures', 'placements', 'exports', 'pen_presets', 'templates'];
      const oldIds = new Map<string, string[]>(); for (const t of idTables) oldIds.set(t, (await a.query<{ id: string }>(`SELECT id FROM ${t}`)).map((r) => String(r.id)));
      const oldRefs = (await a.query<{ r: string }>('SELECT file_ref AS r FROM documents UNION SELECT file_ref FROM exports UNION SELECT image_ref FROM signatures WHERE image_ref IS NOT NULL')).map((r) => String(r.r));
      expect([...oldIds.values()].flat().length, 'state B must hold data').toBeGreaterThan(0);
      await restore(dasig);
      expect(await h.snapshot(a)).toEqual(sA);
      const left: string[] = [];
      for (const [t, ids] of oldIds) for (const id of ids) if ((await a.query(`SELECT 1 FROM ${t} WHERE id = ?`, [id])).length) left.push(`${t}.${id}`);
      for (const r of oldRefs) if (await a.getFile(r).then(() => true, () => false)) left.push(`file ${r}`);
      expect(left, 'pre-existing records/files still present after restore').toEqual([]);
    }, timeout);

    it('BAK-01-C16 (PM #68) a CANCELLED restore (confirm sheet -> Cancel) changes nothing: confirm asked once, before any write; storage byte-identical', async () => {
      const { dasig, b } = await backupAThenStateB();
      let asked = 0; let atAsk: Snapshot | undefined;
      const diff = await rawAround(async () => {
        await h.restoreBackup(a, dasig, PW, async () => { asked++; atAsk = await h.snapshot(a); return false; }).catch(() => undefined);
      });
      expect(asked, 'the destructive confirm must be consulted exactly once').toBe(1);
      expect(atAsk, 'nothing may be written before the user confirms').toEqual(b);
      expect(diff, 'storage after a cancelled restore').toEqual([]);
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);

    it('BAK-01-C17 (PM #69) a backup with a NEWER data schema is refused with the dedicated error + "update DaSignature"; storage byte-identical', async () => {
      const { dasig, b } = await backupAThenStateB();
      const newer = await h.withSchemaVersion(dasig, PW, h.currentSchemaVersion + 1);
      let err: unknown = null;
      expect(await rawAround(async () => { err = await restore(newer).then(() => null, (e: unknown) => e); })).toEqual([]);
      expect(updateRequiredProblems(err, h.newerBackup)).toEqual([]);
      expect(await h.snapshot(a)).toEqual(b);
    }, timeout);
  });
}
