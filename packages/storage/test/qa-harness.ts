/**
 * Harnesses that plug every StorageAdapter implementation into QA's contract suites
 * (test/qa/*, copied verbatim from qa/contract/storage). Test-only: nothing in src/ imports this.
 *
 * A "kit" describes one adapter implementation over one backing store. The test-only hooks
 * (raw persisted bytes, the data key) live here and in the kit factories under test/, never in src/
 * (enforced by test/hooks-isolation.test.ts and the ESLint rule for packages/storage/src).
 */
import { t } from '@dasignature/i18n';
import { unzipSync, zipSync } from 'fflate';
import {
  createBackup,
  DASIG_VERSION,
  decryptDasig,
  encodeDasig,
  readManifest,
  restoreBackup,
} from '../src/backup.ts';
import { fromBase64, sha256Hex, toBase64 } from '../src/bytes.ts';
import { deriveKeyBytes, newKdfParams } from '../src/crypto/kdf.ts';
import {
  AppLock,
  AUTO_LOCK_DEFAULT,
  AUTO_LOCK_OPTIONS,
  type KeyValueStore,
  type VaultSource,
  WebKeyManager,
} from '../src/crypto/keys.ts';
import { DataStore } from '../src/datastore.ts';
import { isUpdateRequired } from '../src/errors.ts';
import { FILE_COLUMNS } from '../src/fields.ts';
import { MIGRATIONS, migrate, SCHEMA_VERSION, TABLES } from '../src/schema.ts';
import type { Row, StorageAdapter } from '../src/types.ts';
import type { AdapterHarness, Snapshot, StorageAdapter as QaAdapter } from './qa/types.ts';
import type { MigrationHarness } from './qa/migrations-contract.ts';
import type { EncryptionHarness } from './qa/encryption-contract.ts';
import type { BackupHarness } from './qa/backup-contract.ts';
import { MARKERS, fixturePdf } from './qa/fixtures.ts';

export type RawFile = { path: string; bytes: Uint8Array };

export interface Kit {
  initOpts: { key?: CryptoKey | string };
  /** A new adapter instance over this kit's store (not yet initialised). */
  adapter(): StorageAdapter;
  /** The key source for an app start. Web kits: WebKeyManager + AppLock over `kv`. */
  keys: 'web' | { vault: () => Promise<VaultSource> };
  /** Web kits: where the wrapped data key lives (IndexedDB on web, memory in Node). */
  kv?: () => KeyValueStore;
  /** Encryption contract mode; default 'column'. 'sqlcipher' = the real desktop backend. */
  encMode?: 'column' | 'sqlcipher';
  /** TEST-ONLY hook: every persisted byte of the store (call after close). */
  rawBytes(): Promise<RawFile[]>;
  /** TEST-ONLY hook: the 32 raw data-key bytes. */
  dataKey(): Promise<Uint8Array>;
  /** Removes everything this kit stored. */
  wipe(): Promise<void>;
}

/** Test-only: unwrap the device-bound record a WebKeyManager wrote and export the raw DEK. */
export async function exportWebDataKey(kv: KeyValueStore): Promise<Uint8Array> {
  const rec = (await kv.get('dek')) as
    { mode: string; kek?: CryptoKey; wrapped: Uint8Array } | undefined;
  if (!rec?.kek) throw new Error('exportWebDataKey: no device-bound record (passcode set?)');
  const dek = await crypto.subtle.unwrapKey(
    'raw',
    new Uint8Array(rec.wrapped),
    rec.kek,
    'AES-KW',
    'AES-GCM',
    true,
    ['encrypt'],
  );
  return new Uint8Array(await crypto.subtle.exportKey('raw', dek));
}

/** Test-only: the bytes of the key records as they would sit in a key store (wrapped key + KDF params). */
export async function kvRawBytes(kv: KeyValueStore): Promise<RawFile[]> {
  const rec = (await kv.get('dek')) as
    { mode: string; wrapped: Uint8Array; kdf?: unknown } | undefined;
  if (!rec) return [];
  return [
    { path: 'keystore/dek.wrapped', bytes: new Uint8Array(rec.wrapped) },
    {
      path: 'keystore/dek.json',
      bytes: new TextEncoder().encode(JSON.stringify({ mode: rec.mode, kdf: rec.kdf ?? null })),
    },
  ];
}

/** The suites type adapters with QA's (structurally looser) interface; they are always ours. */
const own = (a: QaAdapter): StorageAdapter => a as StorageAdapter;
const APP_VERSION = '0.1.0';

/** Mutable per-kit session: the adapter instance and the AppLock of the current "app start". */
class Session {
  lock: AppLock | undefined;
  source: VaultSource | undefined;
  #kv: KeyValueStore | undefined;
  constructor(private readonly kit: Kit) {}
  kv(): KeyValueStore {
    if (!this.kit.kv) throw new Error('kit has no key-value store');
    this.#kv ??= this.kit.kv();
    return this.#kv;
  }
  async start(): Promise<void> {
    if (this.kit.keys === 'web') {
      this.lock = new AppLock(new WebKeyManager(this.kv()));
      await this.lock.resume();
      this.source = this.lock;
    } else {
      this.source = await this.kit.keys.vault();
    }
  }
  forget(): void {
    this.#kv = undefined;
  }
  store(a: QaAdapter): Promise<DataStore> {
    if (!this.source) throw new Error('session not started');
    return DataStore.open(own(a), this.source);
  }
}

function adapterHarness(kit: Kit, s: Session, migrated: boolean): AdapterHarness {
  return {
    initOpts: kit.initOpts,
    async open() {
      const a = kit.adapter();
      await a.init(kit.initOpts);
      if (migrated) await migrate(a);
      await s.start();
      return a;
    },
    async close(a) {
      await own(a).close();
    },
    async destroy() {
      await kit.wipe();
      s.forget();
    },
  };
}

export function storageHarness(kit: Kit): AdapterHarness {
  return adapterHarness(kit, new Session(kit), false);
}

export function migrationHarness(kit: Kit): MigrationHarness {
  const s = new Session(kit);
  return {
    adapter: adapterHarness(kit, s, false),
    migrations: MIGRATIONS.map((m) => ({ ...m, up: (a: QaAdapter) => m.up(own(a)) })),
    migrate: async (a, list) => {
      await migrate(
        own(a),
        undefined,
        list.map((m) => ({ ...m, up: (tx: StorageAdapter) => m.up(tx) })),
      );
    },
    seed: async (a, version) => {
      if (version < 1) return;
      const at = '2026-10-19T12:00:00.000+02:00';
      await a.exec(
        "INSERT INTO documents (id, title, file_ref, sha256, page_count, status, created_at, updated_at) VALUES ('d1', 't', 'r1', 'h', 3, 'signed', ?, ?)",
        [at, at],
      );
      await a.exec(
        "INSERT INTO signatures (id, kind, source, name, strokes_json, svg_path, image_ref, typed_text, font_id, color, opacity, is_default, created_at) VALUES ('s1', 'signature', 'draw', 'n', '[]', 'M0 0', NULL, NULL, 'f', '#000', 0.9, 1, ?)",
        [at],
      );
      await a.exec(
        "INSERT INTO placements (id, document_id, page_index, type, signature_id, x, y, w, h, rotation, opacity, data_json, z_index) VALUES ('p1', 'd1', 2, 'signature', 's1', 0.1, 0.2, 0.3, 0.4, 15, 0.8, '{}', 2)",
      );
      await a.exec(
        "INSERT INTO exports (id, document_id, file_ref, sha256, signer_name, created_at) VALUES ('e1', 'd1', 'r2', 'h2', 'x', ?)",
        [at],
      );
      await a.exec(
        "INSERT INTO pen_presets (id, name, settings_json) VALUES ('pp1', 'Fine', '{}')",
      );
      await a.exec("INSERT INTO templates (id, name, placements_json) VALUES ('t1', 'T', '[]')");
      await a.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    },
    rawBytes: () => kit.rawBytes(),
    newerSchema: {
      errorName: 'SchemaTooNewError',
      userMessage: (err) => (isUpdateRequired(err) ? t(err.messageKey) : String(err)),
    },
  };
}

async function writeFixtures(
  store: DataStore,
  variant: 'A' | 'B',
): Promise<{ documentId: string }> {
  const A = variant === 'A';
  const pdf = A ? fixturePdf() : fixturePdf(5000);
  const doc = await store.addDocument({ title: A ? MARKERS.title : 'B-title', pdf, pageCount: 1 });
  const sigId = A ? '0190a000-0000-7000-8000-00000000000a' : '0190a000-0000-7000-8000-00000000000b';
  await store.insert('signatures', {
    id: sigId,
    kind: 'signature',
    source: 'draw',
    name: A ? MARKERS.signatureName : 'B-name',
    strokes_json: A ? MARKERS.strokes : '[]',
    svg_path: A ? MARKERS.svg : 'M1 1',
    typed_text: A ? MARKERS.typed : 'B-typed',
    image_ref: await store.putSealedFile(
      'signatures',
      sigId,
      new Uint8Array([137, 80, 78, 71, A ? 1 : 2]),
      'sig.png',
    ),
    created_at: '2026-10-19T12:00:00.000Z',
  });
  await store.insert('placements', {
    id: A ? '0190a000-0000-7000-8000-0000000001a0' : '0190a000-0000-7000-8000-0000000001b0',
    document_id: doc.id,
    page_index: 0,
    type: 'signature',
    signature_id: sigId,
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.1,
    data_json: A ? MARKERS.placementData : '{}',
  });
  await store.addExport({
    documentId: doc.id,
    pdf: fixturePdf(A ? 7 : 9),
    signerName: A ? MARKERS.signer : 'B-signer',
  });
  await store.insert('pen_presets', {
    id: A ? '0190a000-0000-7000-8000-0000000002a0' : '0190a000-0000-7000-8000-0000000002b0',
    name: 'Fine',
    settings_json: '{"width":2}',
  });
  await store.insert('templates', {
    // Full-length ids: QA's manifest leak scan (BAK-01-C14) looks for every id in the manifest
    // text, and a 2-character id can occur by chance inside the base64 salt or IV.
    id: A ? '0190a000-0000-7000-8000-0000000003a0' : '0190a000-0000-7000-8000-0000000003b0',
    name: A ? MARKERS.templateName : 'B-template',
    placements_json: A ? MARKERS.templatePlacements : '[]',
  });
  await store.setSetting('signer_name', A ? MARKERS.signer : 'B-signer');
  return { documentId: doc.id };
}

export function encryptionHarness(kit: Kit): EncryptionHarness {
  const s = new Session(kit);
  const h: EncryptionHarness = {
    adapter: adapterHarness(kit, s, true),
    // The bridge fakes don't model SQLCipher, so they run in 'column' mode (every platform also
    // applies the PM #17 column encryption). The real desktop backend runs in 'sqlcipher' mode.
    mode: kit.encMode ?? 'column',
    writeFixtures: async (a) => writeFixtures(await s.store(a), 'A'),
    readFixtures: async (a) => {
      const store = await s.store(a);
      const [doc] = await store.listDocuments();
      if (!doc) throw new Error('no document');
      const [sig] = await store.select<{ typed_text: string; name: string }>('signatures');
      const [exp] = await store.select<{ signer_name: string }>('exports');
      return {
        title: doc.title,
        signer: exp?.signer_name ?? '',
        typed: sig?.typed_text ?? '',
        signatureName: sig?.name ?? '',
        pdf: await store.getDocumentPdf(doc),
      };
    },
    rawBytes: () => kit.rawBytes(),
    decodeCiphertext: (stored) => fromBase64(String(stored)),
    tamper: async (a, table, column, id, mutate) => {
      const [r] = await a.query<Record<string, string>>(
        `SELECT ${column} AS v FROM ${table} WHERE id = ?`,
        [id],
      );
      if (!r) throw new Error('no row to tamper with');
      await a.exec(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [
        toBase64(mutate(fromBase64(String(r.v)))),
        id,
      ]);
    },
    exportDataKey: () => kit.dataKey(),
    kdf: async (password, salt, o) => {
      const p = newKdfParams(o.forceFallback ? 'pbkdf2-sha256' : 'argon2id');
      return deriveKeyBytes(password, { ...p, salt: toBase64(salt) });
    },
  };
  if (kit.keys === 'web') {
    const lock = () => {
      if (!s.lock) throw new Error('no AppLock');
      return s.lock;
    };
    h.lock = {
      setPasscode: (p) => lock().setPasscode(p),
      lock: async () => {
        lock().lock();
        await Promise.resolve();
      },
      unlock: (p) => lock().unlock(p),
      isKeyInMemory: async () => {
        await Promise.resolve();
        return lock().isUnlocked();
      },
      autoLockOptions: () => AUTO_LOCK_OPTIONS,
      autoLockDefault: () => AUTO_LOCK_DEFAULT,
    };
  }
  return h;
}

export async function snapshotOf(store: DataStore): Promise<Snapshot> {
  const dump = await store.dumpPlain();
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    // File refs are opaque and remapped on restore; files are compared by content hash instead.
    const strip = new Set(FILE_COLUMNS[t] ?? []);
    tables[t] = dump.tables[t].map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !strip.has(k))),
    );
  }
  const fileHashes = (await Promise.all([...dump.files.values()].map((b) => sha256Hex(b)))).sort();
  return { tables, fileHashes };
}

export function backupHarness(kit: Kit): BackupHarness {
  const s = new Session(kit);
  return {
    adapter: adapterHarness(kit, s, true),
    writeFixtures: async (a, v) => {
      await writeFixtures(await s.store(a), v);
    },
    snapshot: async (a) => snapshotOf(await s.store(a)),
    createBackup: async (a, pw) => createBackup(await s.store(a), pw, { appVersion: APP_VERSION }),
    // The product entry point with the confirm sheet as the PM #68 callback.
    restoreBackup: async (a, dasig, pw, confirm) => {
      await restoreBackup(await s.store(a), dasig, pw, confirm);
    },
    splitBackup: (dasig) => {
      const { manifestBytes, payload } = readManifest(dasig);
      return { manifest: manifestBytes, payload };
    },
    rewriteManifest: async (dasig, pw, patch) => {
      const { manifest, plain } = await decryptDasig(dasig, pw);
      return encodeDasig(
        plain,
        pw,
        {
          createdAt: manifest.createdAt,
          appVersion: manifest.appVersion,
          kdf: { ...manifest.kdf, salt: manifest.salt },
        },
        (m) => patch(m as unknown as Record<string, unknown>),
      );
    },
    withSchemaVersion: async (dasig, pw, v) => {
      const { manifest, plain } = await decryptDasig(dasig, pw);
      const inner = unzipSync(plain);
      const data = JSON.parse(new TextDecoder().decode(inner['data.json'])) as Record<
        string,
        unknown
      >;
      inner['data.json'] = new TextEncoder().encode(JSON.stringify({ ...data, schemaVersion: v }));
      return encodeDasig(zipSync(inner), pw, {
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        kdf: { ...manifest.kdf, salt: manifest.salt },
      });
    },
    versionField: 'version',
    currentVersion: DASIG_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    manifestKdf: (m) => ({
      ...(m.kdf as { alg: string; memoryKiB?: number; iterations: number; parallelism?: number }),
      salt: String(m.salt),
    }),
    newerBackup: {
      errorName: 'BackupVersionError',
      userMessage: (err) => (isUpdateRequired(err) ? t(err.messageKey) : String(err)),
    },
    rawBytes: () => kit.rawBytes(),
  };
}
