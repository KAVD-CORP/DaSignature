// ENC-02 (web, column mode) / ENC-01 (native, SQLCipher mode) / ENC-KDF / ENC-LOCK-M2: encryption-at-rest contract.
// SPEC Sec 6 "Encryption"; PM #17 + #65 (what is encrypted; #65 adds signatures.name), #38 (templates encrypted, sha256 plaintext), #18 (KDF + AES-GCM),
// #19 (auto-lock options). Layer-agnostic: the harness writes fixtures through the Engineer's REAL services and exposes
// the raw persisted bytes, so it doesn't matter whether encryption sits in the adapter or in the services.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AdapterHarness, StorageAdapter } from './types.ts';
import { MARKERS, fixturePdf, sha256hex, findText, indexOf, UUID_V7, ISO_WITH_OFFSET } from './fixtures.ts';

/** PM #17 + #65 + #38: values that must never appear in plaintext at rest. table.column -> marker written by writeFixtures. */
export const SENSITIVE_COLUMNS: Record<string, keyof typeof MARKERS> = {
  'documents.title': 'title', 'signatures.name': 'signatureName', 'signatures.strokes_json': 'strokes', 'signatures.svg_path': 'svg', 'signatures.typed_text': 'typed',
  'placements.data_json': 'placementData', 'exports.signer_name': 'signer', 'templates.name': 'templateName', 'templates.placements_json': 'templatePlacements',
};
/** PM #17 + #38: values that must stay plaintext (integrity check, sorting, migrations). */
export const PLAINTEXT_COLUMNS = ['documents.id', 'documents.sha256', 'documents.page_count', 'documents.status', 'documents.created_at', 'documents.updated_at', 'exports.sha256', 'exports.created_at', 'pen_presets.settings_json'] as const;

/** Known-answer vectors, password "dasignature-qa-kat", salt = bytes 00..0f, 32-byte output. Each was cross-checked by two
 *  independent implementations (hash-wasm + argon2-cffi; Node crypto + Python hashlib), 2026-10-19. */
export const KDF_KAT = {
  password: 'dasignature-qa-kat', salt: Uint8Array.from({ length: 16 }, (_, i) => i),
  argon2id_m65536_t3_p1: '69a6f4f0ab55d101f7216a0331b4260938dcbe276dd1287361431d1982b127c5',
  pbkdf2_sha256_600000: 'ffcee796694aeccfa04c04ce9dc643345ab4fa9949cfd1c15f16392322fd2342',
  controls: { 'Argon2id with t=2 (too weak)': 'ddef30e607f1a5de3a23d73fd7b2eecaff946ed571a8d588ad4edcbd3c757794', 'PBKDF2 with 310,000 iterations (too weak)': 'bf5eaf5efcba3ae236ad462a161baf8ecb0d1341d64fcd29d237e99bde1a6828' },
} as const;
/** PM #19, in minutes; 0 = Immediately, null = Never. */
export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 30, null] as const;
export const AUTO_LOCK_DEFAULT = 5;

export interface EncryptionHarness {
  adapter: AdapterHarness;                    // opens a migrated, unlocked store
  mode: 'column' | 'sqlcipher';               // web = column (AES-GCM per value/blob); native = whole-DB SQLCipher
  /** Write one of everything with MARKERS via the real services: document (fixturePdf()), signature (all four sensitive fields
   *  plus an image blob), placement, export (signer_name = MARKERS.signer, export blob), template, signer-name setting.
   *  signatures.name = MARKERS.signatureName (PM #65). */
  writeFixtures(a: StorageAdapter): Promise<{ documentId: string }>;
  /** Read the same fixtures back through the real services (decrypted view). */
  readFixtures(a: StorageAdapter): Promise<{ title: string; signer: string; typed: string; signatureName: string; pdf: Uint8Array }>;
  /** Every persisted artifact for this store: DB file(s) including -wal/-journal/-shm, every blob/OPFS file, key-wrap records. */
  rawBytes(): Promise<{ path: string; bytes: Uint8Array }[]>;
  /** column mode: stored representation of a sensitive value -> IV(12) || ciphertext || tag(16). */
  decodeCiphertext?(stored: unknown): Uint8Array;
  /** column mode: overwrite one stored ciphertext in place (for the tamper case). */
  tamper?(a: StorageAdapter, table: string, column: string, id: string, mutate: (b: Uint8Array) => Uint8Array): Promise<void>;
  /** Raw data key bytes (test builds only) to prove the key isn't stored in the clear. */
  exportDataKey?(): Promise<Uint8Array>;
  /** The production KDF entry point, raw 32-byte output. forceFallback simulates Argon2 WASM being unavailable. */
  kdf?: (password: string, salt: Uint8Array, o: { forceFallback: boolean }) => Promise<Uint8Array>;
  /** LockService hooks (present once the Engineer ships key wrapping; options/default may arrive with M7 UI). */
  lock?: { setPasscode(p: string): Promise<void>; lock(): Promise<void>; unlock(p: string): Promise<void>; isKeyInMemory(): Promise<boolean>; autoLockOptions?(): readonly (number | null)[]; autoLockDefault?(): number | null };
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function runEncryptionContract(name: string, h: EncryptionHarness, timeout = 120_000): void {
  describe(`ENC encryption-at-rest contract: ${name} (${h.mode})`, () => {
    let a: StorageAdapter; let docId = '';
    beforeEach(async () => { await h.adapter.destroy(); a = await h.adapter.open(); ({ documentId: docId } = await h.writeFixtures(a)); }, timeout);
    afterEach(async () => { await h.adapter.close(a); await h.adapter.destroy(); }, timeout);
    const rawAfterClose = async () => { await h.adapter.close(a); const r = await h.rawBytes(); a = await h.adapter.open(); return r; };

    it('ENC-C01 no sensitive marker appears in ANY persisted byte (UTF-8 or UTF-16LE), after close (WAL checkpointed or not)', async () => {
      const raw = await rawAfterClose();
      expect(raw.length).toBeGreaterThan(0);
      const hits: string[] = [];
      for (const f of raw) for (const [k, m] of Object.entries(MARKERS)) for (const e of findText(f.bytes, m)) hits.push(`${k} (${e}) in ${f.path}`);
      expect(hits).toEqual([]);
    }, timeout);

    it('ENC-C02 no persisted file contains a plaintext PDF (%PDF- magic or the fixture body)', async () => {
      const raw = await rawAfterClose();
      const pdfHits = raw.filter((f) => indexOf(f.bytes, new TextEncoder().encode('%PDF-')) >= 0).map((f) => f.path);
      expect(pdfHits).toEqual([]);
    }, timeout);

    it('ENC-C03 the decrypted view round-trips exactly, and the PDF bytes equal the original (AC3)', async () => {
      const r = await h.readFixtures(a);
      expect(r.title).toBe(MARKERS.title); expect(r.signer).toBe(MARKERS.signer); expect(r.typed).toBe(MARKERS.typed);
      expect(r.signatureName, 'signatures.name round-trips (PM #65)').toBe(MARKERS.signatureName);
      expect(await sha256hex(r.pdf)).toBe(await sha256hex(fixturePdf()));
    }, timeout);

    it('ENC-C04 plaintext columns stay plaintext (PM #17/#38): sha256 hex equals the PDF hash, ids uuid v7, timestamps ISO-8601+offset', async () => {
      const [d] = await a.query<Record<string, unknown>>('SELECT id, sha256, page_count, status, created_at, updated_at FROM documents WHERE id = ?', [docId]);
      expect(d?.sha256).toBe(await sha256hex(fixturePdf()));
      expect(String(d?.id)).toMatch(UUID_V7);
      expect(Number(d?.page_count)).toBe(1); expect(d?.status).toBe('draft');
      expect(String(d?.created_at)).toMatch(ISO_WITH_OFFSET); expect(String(d?.updated_at)).toMatch(ISO_WITH_OFFSET);
      const [e] = await a.query<{ sha256: string }>('SELECT sha256 FROM exports WHERE document_id = ?', [docId]);
      expect(e?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }, timeout);

    if (h.mode === 'column') {
      it('ENC-C05 every PM #17/#38 column is AES-GCM shaped (IV 12 B + ciphertext + tag 16 B) and every IV is unique (PM #18)', async () => {
        if (!h.decodeCiphertext) throw new Error('column mode needs decodeCiphertext()');
        const ivs = new Map<string, string>(); const problems: string[] = [];
        for (const [tc, marker] of Object.entries(SENSITIVE_COLUMNS)) {
          const [table, col] = tc.split('.') as [string, string];
          const rows = await a.query<Record<string, unknown>>(`SELECT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`);
          if (!rows.length) { problems.push(`${tc}: no row written by writeFixtures`); continue; }
          for (const r of rows) {
            const ct = h.decodeCiphertext(r.v);
            const minLen = 12 + 16 + (marker === 'title' ? 1 : 0);
            if (ct.length < minLen) problems.push(`${tc}: ${ct.length} B is too short for IV+tag`);
            const iv = hex(ct.slice(0, 12)); if (ivs.has(iv)) problems.push(`IV reuse: ${tc} and ${ivs.get(iv)}`); ivs.set(iv, tc);
          }
        }
        expect(problems).toEqual([]);
      }, timeout);

      it('ENC-C06 tampering with one ciphertext byte makes the read FAIL (GCM authentication), never return garbage', async () => {
        if (!h.tamper) throw new Error('column mode needs tamper()');
        await h.tamper(a, 'documents', 'title', docId, (b) => { const c = b.slice(); c[c.length - 1] = (c[c.length - 1] ?? 0) ^ 0x01; return c; });
        await expect(h.readFixtures(a)).rejects.toBeTruthy();
      }, timeout);
    } else {
      it('ENC-C05n native DB file is not a plain SQLite file (SQLCipher): header is not "SQLite format 3\\0"', async () => {
        const raw = await rawAfterClose();
        const db = raw.filter((f) => /\.(db|sqlite3?)$/i.test(f.path)); expect(db.length).toBeGreaterThan(0);
        for (const f of db) expect(new TextDecoder().decode(f.bytes.slice(0, 16))).not.toBe('SQLite format 3\u0000');
      }, timeout);
    }

    it('ENC-C07 the data key never appears in the clear at rest (only wrapped / in the OS credential store)', async () => {
      if (!h.exportDataKey) throw new Error('exportDataKey() test hook missing (required from M2: SPEC Sec 6 key handling)');
      const key = await h.exportDataKey(); expect(key.length).toBe(32);
      const raw = await rawAfterClose();
      // Raw bytes AND the usual textual encodings (hex lower/upper, base64, base64url), each as UTF-8 and UTF-16LE (via findText).
      const h16 = [...key].map((b) => b.toString(16).padStart(2, '0')).join('');
      let b64 = ''; for (const b of key) b64 += String.fromCharCode(b); b64 = btoa(b64);
      const texts = [h16, h16.toUpperCase(), b64.replace(/=+$/, ''), b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')];
      const leaks = raw.flatMap((f) => [...(indexOf(f.bytes, key) >= 0 ? [`${f.path}: raw`] : []), ...texts.flatMap((t, i) => findText(f.bytes, t).map((enc) => `${f.path}: ${['hex', 'HEX', 'base64', 'base64url'][i]}/${enc}`))]);
      expect(leaks).toEqual([]);
    }, timeout);

    if (h.kdf) {
      const kdf = h.kdf;
      it('ENC-KDF-01 primary KDF is Argon2id m=64 MiB, t=3, p=1, 32-byte output (PM #18): known-answer test', async () => {
        const out = hex(await kdf(KDF_KAT.password, KDF_KAT.salt, { forceFallback: false }));
        const ctl = Object.entries(KDF_KAT.controls).find(([, v]) => v === out)?.[0];
        expect(out, ctl ? `matches control: ${ctl}` : 'not Argon2id(m=65536 KiB, t=3, p=1)').toBe(KDF_KAT.argon2id_m65536_t3_p1);
      }, timeout);
      it('ENC-KDF-02 fallback KDF is PBKDF2-SHA256 with 600,000 iterations (PM #18): known-answer test, cross-checked with WebCrypto', async () => {
        const out = hex(await kdf(KDF_KAT.password, KDF_KAT.salt, { forceFallback: true }));
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(KDF_KAT.password), 'PBKDF2', false, ['deriveBits']);
        const ref = hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: KDF_KAT.salt, iterations: 600_000 }, base, 256)));
        expect(ref).toBe(KDF_KAT.pbkdf2_sha256_600000);
        const ctl = Object.entries(KDF_KAT.controls).find(([, v]) => v === out)?.[0];
        expect(out, ctl ? `matches control: ${ctl}` : 'not PBKDF2-SHA256 600k').toBe(KDF_KAT.pbkdf2_sha256_600000);
      }, timeout);
    }

    if (h.lock) {
      const L = h.lock;
      it('ENC-LOCK-01 lock() drops the in-memory data key: reads fail until unlock; a wrong passcode never unlocks', async () => {
        await L.setPasscode('qa-passcode-1'); await L.lock();
        expect(await L.isKeyInMemory()).toBe(false);
        await expect(h.readFixtures(a)).rejects.toBeTruthy();
        await expect(L.unlock('wrong')).rejects.toBeTruthy(); expect(await L.isKeyInMemory()).toBe(false);
        await L.unlock('qa-passcode-1'); expect((await h.readFixtures(a)).title).toBe(MARKERS.title);
      }, timeout);
      it('ENC-LOCK-02 the passcode wraps the data key: reopen with the passcode set still needs unlock (key not persisted unwrapped)', async () => {
        await L.setPasscode('qa-passcode-2'); await h.adapter.close(a); a = await h.adapter.open();
        await expect(h.readFixtures(a)).rejects.toBeTruthy();
        await L.unlock('qa-passcode-2'); expect((await h.readFixtures(a)).title).toBe(MARKERS.title);
      }, timeout);
      if (L.autoLockOptions && L.autoLockDefault) {
        const opts = L.autoLockOptions, dflt = L.autoLockDefault;
        it('ENC-LOCK-03 auto-lock options are exactly Immediately/1/5/15/30 min/Never with default 5 (PM #19)', () => {
          expect([...opts()]).toEqual([...AUTO_LOCK_OPTIONS]); expect(dflt()).toBe(AUTO_LOCK_DEFAULT);
        });
      }
    }
  });
}
