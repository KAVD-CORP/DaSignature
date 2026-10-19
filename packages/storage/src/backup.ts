import { unzipSync, zipSync, type Zippable } from 'fflate';
import {
  concatBytes,
  fromBase64,
  fromUtf8,
  randomBytes,
  sha256Hex,
  toArrayBuffer,
  toBase64,
  utf8,
} from './bytes.ts';
import { deriveKeyBytes, newKdfParams, type KdfParams } from './crypto/kdf.ts';
import { importAesKey, IV_BYTES, TAG_BYTES } from './crypto/vault.ts';
import type { DataStore, PlainDump } from './datastore.ts';
import {
  BackupCorruptError,
  BackupFormatError,
  BackupPasswordError,
  BackupVersionError,
  RestoreNotConfirmedError,
} from './errors.ts';
import { FILE_COLUMNS } from './fields.ts';
import { SCHEMA_VERSION, TABLES, type TableName } from './schema.ts';
import type { Row } from './types.ts';
import { strictUnzipStored } from './zip-strict.ts';

/**
 * .dasig v1 backup container. The format is specified in docs/backup-format.md (canonical; QA's
 * docs/dasig-format.md points to it). Keep the two in sync.
 *
 * Outer: a stored (uncompressed) ZIP with exactly manifest.json, payload.bin and README.txt.
 * manifest.json (plaintext, PM #67): ONLY version, appVersion, createdAt, kdf (id + params), salt,
 * iv (base nonce) and cipher. Everything else, including the schema version and all counts, is in
 * the encrypted payload.
 * payload.bin: keyCheck tag (16 B) followed by the AES-256-GCM sealed chunks (ciphertext + tag each)
 * of the inner archive. Plaintext chunk size is fixed at 1 MiB for v1.
 */
export const DASIG_VERSION = 1;
export const DASIG_CIPHER = 'AES-256-GCM';
export const CHUNK_SIZE = 1024 * 1024;
/** PM #67: the only fields a v1 manifest may contain. */
export const MANIFEST_FIELDS = [
  'version',
  'appVersion',
  'createdAt',
  'kdf',
  'salt',
  'iv',
  'cipher',
] as const;
const KEYCHECK_COUNTER = 0xffffffff;
const SEALED_CHUNK = CHUNK_SIZE + TAG_BYTES;

export interface DasigManifest {
  version: number;
  appVersion: string;
  createdAt: string;
  /** KDF id and parameters (PM #18/#66), without the salt. */
  kdf:
    | { alg: 'argon2id'; memoryKiB: number; iterations: number; parallelism: number }
    | { alg: 'pbkdf2-sha256'; iterations: number };
  /** Base64 KDF salt, random per backup (PM #66). */
  salt: string;
  /** Base64 96-bit base nonce, random per backup; chunk i uses it with the last 4 bytes XOR i. */
  iv: string;
  cipher: typeof DASIG_CIPHER;
}

export interface BackupOptions {
  appVersion?: string;
  now?: () => string;
  /** Tests only: a faster KDF. Defaults to PM #18 Argon2id with a fresh random salt. */
  kdf?: KdfParams;
}

function nonce(base: Uint8Array, counter: number): Uint8Array {
  const iv = base.slice();
  const v = new DataView(iv.buffer);
  v.setUint32(8, (v.getUint32(8) ^ counter) >>> 0);
  return iv;
}
const keyCheckAad = (salt: string) => utf8(`dasig/v1/keycheck/${salt}`);
const chunkAad = (i: number, last: boolean, manifestHash: string) =>
  utf8(`dasig/v1/chunk/${String(i)}/${last ? 'last' : 'more'}/${manifestHash}`);

async function gcm(
  op: 'encrypt' | 'decrypt',
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const p = {
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    additionalData: toArrayBuffer(aad),
    tagLength: 128,
  };
  return new Uint8Array(
    op === 'encrypt'
      ? await crypto.subtle.encrypt(p, key, toArrayBuffer(data))
      : await crypto.subtle.decrypt(p, key, toArrayBuffer(data)),
  );
}

function splitKdf(k: KdfParams): { kdf: DasigManifest['kdf']; salt: string } {
  if (k.alg === 'argon2id')
    return {
      kdf: {
        alg: k.alg,
        memoryKiB: k.memoryKiB,
        iterations: k.iterations,
        parallelism: k.parallelism,
      },
      salt: k.salt,
    };
  return { kdf: { alg: k.alg, iterations: k.iterations }, salt: k.salt };
}

/** Builds a password-encrypted .dasig backup of everything in `store`. */
export async function createBackup(
  store: DataStore,
  password: string,
  opts: BackupOptions = {},
): Promise<Uint8Array> {
  if (password.length === 0) throw new RangeError('backup password must not be empty');
  const dump = await store.dumpPlain();
  const inner: Zippable = {
    'data.json': utf8(JSON.stringify({ schemaVersion: dump.schemaVersion, tables: dump.tables })),
  };
  for (const [ref, bytes] of dump.files) inner[`files/${ref}`] = [bytes, { level: 0 }];
  return encodeDasig(zipSync(inner, { level: 6 }), password, {
    createdAt: (opts.now ?? (() => new Date().toISOString()))(),
    appVersion: opts.appVersion ?? '0.0.0',
    kdf: opts.kdf ?? newKdfParams(),
  });
}

/** Encrypts an inner archive into the .dasig container. `patch` exists for format tests only. */
export async function encodeDasig(
  plain: Uint8Array,
  password: string,
  o: { createdAt: string; appVersion: string; kdf: KdfParams },
  patch: (m: DasigManifest) => Record<string, unknown> = (m) => ({ ...m }),
): Promise<Uint8Array> {
  const key = await importAesKey(await deriveKeyBytes(password, o.kdf));
  const base = randomBytes(IV_BYTES);
  const manifest: DasigManifest = {
    version: DASIG_VERSION,
    appVersion: o.appVersion,
    createdAt: o.createdAt,
    ...splitKdf(o.kdf),
    iv: toBase64(base),
    cipher: DASIG_CIPHER,
  };
  const manifestBytes = utf8(JSON.stringify(patch(manifest), null, 2));
  const mhash = await sha256Hex(manifestBytes);
  const parts = [
    await gcm(
      'encrypt',
      key,
      nonce(base, KEYCHECK_COUNTER),
      keyCheckAad(manifest.salt),
      new Uint8Array(0),
    ),
  ];
  const count = Math.max(1, Math.ceil(plain.length / CHUNK_SIZE));
  for (let i = 0; i < count; i++) {
    const chunk = plain.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    parts.push(
      await gcm('encrypt', key, nonce(base, i), chunkAad(i, i === count - 1, mhash), chunk),
    );
  }
  return zipSync(
    {
      'manifest.json': manifestBytes,
      'payload.bin': concatBytes(...parts),
      'README.txt': utf8(README),
    },
    { level: 0 },
  );
}

const README =
  'DaSignature backup (.dasig). Encrypted with your backup password.\n' +
  'Open it in DaSignature: Settings > Backup > Restore. Format: docs/backup-format.md\n';

function corrupt(why: string): never {
  throw new BackupCorruptError(`backup is damaged: ${why}`);
}
const isInt = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Reads and validates the plaintext manifest (no password needed). */
export function readManifest(file: Uint8Array): {
  manifest: DasigManifest;
  manifestBytes: Uint8Array;
  payload: Uint8Array;
} {
  let outer: Map<string, Uint8Array>;
  try {
    outer = strictUnzipStored(file);
  } catch (err) {
    corrupt(`not a valid .dasig container (${(err as Error).message})`);
  }
  const manifestBytes = outer.get('manifest.json');
  if (!manifestBytes) throw new BackupFormatError('not a .dasig backup (no manifest.json)');
  for (const name of outer.keys())
    if (!['manifest.json', 'payload.bin', 'README.txt'].includes(name))
      corrupt(`unexpected entry ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(manifestBytes));
  } catch {
    corrupt('manifest is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    corrupt('manifest is not an object');
  const m = parsed as Record<string, unknown>;
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1)
    corrupt('manifest version is invalid');
  if (m.version > DASIG_VERSION)
    throw new BackupVersionError(`backup format version ${String(m.version)} needs a newer app`);
  const extra = Object.keys(m).filter((k) => !(MANIFEST_FIELDS as readonly string[]).includes(k));
  if (extra.length) corrupt(`unexpected manifest fields: ${extra.join(', ')}`);
  const k = m.kdf as Record<string, unknown> | null;
  const kdfOk =
    k !== null &&
    typeof k === 'object' &&
    (k.alg === 'argon2id'
      ? Object.keys(k).length === 4 &&
        isInt(k.memoryKiB, 8, 1 << 20) &&
        isInt(k.iterations, 1, 64) &&
        isInt(k.parallelism, 1, 16)
      : k.alg === 'pbkdf2-sha256' &&
        Object.keys(k).length === 2 &&
        isInt(k.iterations, 1, 10_000_000));
  if (
    !kdfOk ||
    m.cipher !== DASIG_CIPHER ||
    typeof m.appVersion !== 'string' ||
    typeof m.createdAt !== 'string' ||
    typeof m.salt !== 'string' ||
    typeof m.iv !== 'string'
  )
    corrupt('manifest fields are invalid');
  const payload = outer.get('payload.bin');
  if (!payload) corrupt('payload.bin is missing');
  if (payload.length < 2 * TAG_BYTES) corrupt('payload is too short');
  return { manifest: m as unknown as DasigManifest, manifestBytes, payload };
}

/** Checks the password and decrypts the payload (the inner archive). Touches nothing. */
export async function decryptDasig(
  file: Uint8Array,
  password: string,
): Promise<{ manifest: DasigManifest; plain: Uint8Array }> {
  const { manifest, manifestBytes, payload } = readManifest(file);
  let key: CryptoKey;
  let base: Uint8Array;
  try {
    base = fromBase64(manifest.iv);
    if (base.length !== IV_BYTES) throw new Error('iv length');
    key = await importAesKey(
      await deriveKeyBytes(password, { ...manifest.kdf, salt: manifest.salt }),
    );
  } catch {
    corrupt('key derivation parameters are invalid');
  }
  try {
    await gcm(
      'decrypt',
      key,
      nonce(base, KEYCHECK_COUNTER),
      keyCheckAad(manifest.salt),
      payload.subarray(0, TAG_BYTES),
    );
  } catch {
    throw new BackupPasswordError('wrong backup password');
  }
  const body = payload.subarray(TAG_BYTES);
  const count = Math.ceil(body.length / SEALED_CHUNK);
  if (count === 0 || body.length - (count - 1) * SEALED_CHUNK < TAG_BYTES)
    corrupt('payload length is invalid');
  const mhash = await sha256Hex(manifestBytes);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const sealed = body.subarray(i * SEALED_CHUNK, (i + 1) * SEALED_CHUNK);
    try {
      parts.push(
        await gcm('decrypt', key, nonce(base, i), chunkAad(i, i === count - 1, mhash), sealed),
      );
    } catch {
      corrupt(`chunk ${String(i)} failed authentication`);
    }
  }
  return { manifest, plain: concatBytes(...parts) };
}

/** Decrypts and validates a backup. Throws BackupPasswordError / BackupCorruptError / BackupVersionError. */
export async function openBackup(file: Uint8Array, password: string): Promise<PlainDump> {
  const { plain } = await decryptDasig(file, password);
  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(plain);
  } catch {
    corrupt('inner archive is unreadable');
  }
  const dataBytes = inner['data.json'];
  if (!dataBytes) corrupt('data.json is missing');
  let data: { schemaVersion?: unknown; tables?: unknown };
  try {
    data = JSON.parse(fromUtf8(dataBytes)) as typeof data;
  } catch {
    corrupt('data.json is not valid JSON');
  }
  if (!isInt(data.schemaVersion, 1, Number.MAX_SAFE_INTEGER)) corrupt('schema version is invalid');
  // PM #69: a backup from a newer schema is refused before anything is touched.
  if ((data.schemaVersion as number) > SCHEMA_VERSION)
    throw new BackupVersionError(
      `backup data schema version ${String(data.schemaVersion)} needs a newer app`,
    );
  const rawTables = data.tables as Record<string, unknown> | undefined;
  if (!rawTables || typeof rawTables !== 'object') corrupt('tables are missing');

  const tables = {} as Record<TableName, Row[]>;
  for (const t of TABLES) {
    const rows = rawTables[t];
    if (
      !Array.isArray(rows) ||
      !rows.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))
    )
      corrupt(`table ${t} is invalid`);
    tables[t] = rows as Row[];
  }
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(inner)) {
    if (name.startsWith('files/')) files.set(name.slice('files/'.length), bytes);
  }
  for (const t of TABLES) {
    for (const col of FILE_COLUMNS[t] ?? []) {
      for (const r of tables[t]) {
        const ref = r[col];
        if (ref === null || ref === undefined) continue;
        if (typeof ref !== 'string' || !files.has(ref)) corrupt(`file for ${t}.${col} is missing`);
      }
    }
  }
  for (const t of ['documents', 'exports'] as const) {
    for (const r of tables[t]) {
      const bytes = files.get(String(r.file_ref));
      if (!bytes || (await sha256Hex(bytes)) !== r.sha256)
        corrupt(`${t} ${String(r.id)} hash mismatch`);
    }
  }
  return { schemaVersion: data.schemaVersion as number, tables, files };
}

/**
 * The explicit confirmation a restore needs (PM #68): either the literal flag, passed after the
 * destructive confirm sheet was accepted, or the confirm sheet itself as a callback. The callback
 * is asked exactly once, after the file has been decrypted and validated and before anything is
 * written; `false` (Cancel) throws RestoreNotConfirmedError and changes nothing.
 */
export type RestoreConfirm = { confirmReplaceAll: true } | (() => Promise<boolean>);

/**
 * Restores a backup, REPLACING all current data (PM #68; merge is v1.1). There is no silent
 * replace: without a confirmation (see RestoreConfirm) it throws RestoreNotConfirmedError.
 * Validation and decryption finish before anything is touched, and the replace is atomic
 * (DataStore.replaceAll), so a failure never leaves a partial restore.
 */
export async function restoreBackup(
  store: DataStore,
  file: Uint8Array,
  password: string,
  confirm: RestoreConfirm,
): Promise<{ documents: number; files: number }> {
  const ask = typeof confirm === 'function' ? confirm : undefined;
  if (!ask && (confirm as { confirmReplaceAll?: unknown } | undefined)?.confirmReplaceAll !== true)
    throw new RestoreNotConfirmedError(
      'restore replaces all data and needs an explicit confirmation (PM #68)',
    );
  const dump = await openBackup(file, password);
  await validateColumns(store, dump);
  if (ask && !(await ask())) throw new RestoreNotConfirmedError('restore was cancelled');
  try {
    await store.replaceAll(dump, { confirmReplaceAll: true });
  } catch (err) {
    throw new BackupCorruptError(`backup could not be applied: ${(err as Error).message}`);
  }
  return { documents: dump.tables.documents.length, files: dump.files.size };
}

async function validateColumns(store: DataStore, dump: PlainDump): Promise<void> {
  for (const t of TABLES) {
    const cols = new Set(
      (await store.db.query<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`)).map(
        (c) => c.name,
      ),
    );
    for (const r of dump.tables[t]) {
      for (const k of Object.keys(r)) if (!cols.has(k)) corrupt(`unknown column ${t}.${k}`);
    }
  }
}
