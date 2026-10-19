import { sha256Hex } from './bytes.ts';
import type { VaultSource } from './crypto/keys.ts';
import { Vault } from './crypto/vault.ts';
import { RestoreNotConfirmedError, StorageError } from './errors.ts';
import { ENCRYPTED_COLUMNS, ENCRYPTED_SETTINGS, FILE_COLUMNS, KEY_COLUMN } from './fields.ts';
import { uuidv7 } from './ids.ts';
import { migrate, TABLES, type TableName } from './schema.ts';
import type { Row, StorageAdapter } from './types.ts';

export interface DocumentRecord {
  id: string;
  title: string;
  file_ref: string;
  sha256: string;
  page_count: number;
  status: 'draft' | 'signed';
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  document_id: string;
  file_ref: string;
  sha256: string;
  signer_name: string | null;
  created_at: string;
}

/** A decrypted snapshot of everything (used by .dasig backups). File keys are the stored refs. */
export interface PlainDump {
  schemaVersion: number;
  tables: Record<TableName, Row[]>;
  files: Map<string, Uint8Array>;
}

const IDENT = /^[a-z][a-z0-9_]*$/;

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  throw new StorageError('encrypted columns hold text');
}

/**
 * The only way app code reads and writes user data. It applies the PM #17/#38 field map, so
 * callers never see ciphertext and never forget to encrypt. M3+ adds feature-specific methods.
 */
export class DataStore {
  readonly #keys: VaultSource;
  private constructor(
    readonly db: StorageAdapter,
    keys: Vault | VaultSource,
    private readonly now: () => string,
  ) {
    this.#keys = keys instanceof Vault ? { vault: () => keys } : keys;
  }

  /** Migrates and opens. `keys` is a Vault or an AppLock (then reads fail while locked). */
  static async open(
    db: StorageAdapter,
    keys: Vault | VaultSource,
    now: () => string = () => new Date().toISOString(),
  ): Promise<DataStore> {
    await migrate(db, now);
    return new DataStore(db, keys, now);
  }

  /** The current vault; throws LockedError while the app is locked. */
  get vault(): Vault {
    return this.#keys.vault();
  }

  /* ------------------------- generic encrypted rows ------------------------- */

  #encryptedCols(table: TableName, row: Row): string[] {
    if (table === 'settings') return ENCRYPTED_SETTINGS.includes(String(row.key)) ? ['value'] : [];
    return [...ENCRYPTED_COLUMNS[table]];
  }

  async encryptRow(table: TableName, row: Row): Promise<Row> {
    const id = String(row[KEY_COLUMN[table]]);
    const out: Row = { ...row };
    for (const c of this.#encryptedCols(table, row)) {
      const v = out[c];
      if (v === null || v === undefined) continue;
      out[c] = await this.vault.sealText(asText(v), `${table}.${c}`, id);
    }
    return out;
  }

  async decryptRow(table: TableName, row: Row): Promise<Row> {
    const id = String(row[KEY_COLUMN[table]]);
    const out: Row = { ...row };
    for (const c of this.#encryptedCols(table, row)) {
      const v = out[c];
      if (v === null || v === undefined) continue;
      out[c] = await this.vault.openText(asText(v), `${table}.${c}`, id);
    }
    return out;
  }

  async insert(table: TableName, row: Row, db: StorageAdapter = this.db): Promise<void> {
    const enc = await this.encryptRow(table, row);
    const cols = Object.keys(enc);
    if (!cols.every((c) => IDENT.test(c))) throw new StorageError('bad column name');
    await db.exec(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => enc[c]),
    );
  }

  async select<T = Row>(table: TableName, where = '', params: unknown[] = []): Promise<T[]> {
    const rows = await this.db.query<Row>(`SELECT * FROM ${table} ${where}`, params);
    return Promise.all(rows.map((r) => this.decryptRow(table, r))) as Promise<T[]>;
  }

  /* ------------------------------- files ------------------------------- */

  /** Seals and stores a blob owned by `table.column` of row `id`; returns the ref. */
  async putSealedFile(
    scope: string,
    id: string,
    bytes: Uint8Array,
    hint: string,
    db = this.db,
  ): Promise<string> {
    return db.putFile(await this.vault.seal(bytes, `${scope}.file`, id), hint);
  }
  async getSealedFile(scope: string, id: string, ref: string): Promise<Uint8Array> {
    return this.vault.open(await this.db.getFile(ref), `${scope}.file`, id);
  }

  /* --------------------------- typed operations --------------------------- */

  async addDocument(input: {
    title: string;
    pdf: Uint8Array;
    pageCount: number;
  }): Promise<DocumentRecord> {
    const id = uuidv7();
    const at = this.now();
    const file_ref = await this.putSealedFile('documents', id, input.pdf, 'doc.pdf');
    const rec: DocumentRecord = {
      id,
      title: input.title,
      file_ref,
      sha256: await sha256Hex(input.pdf),
      page_count: input.pageCount,
      status: 'draft',
      created_at: at,
      updated_at: at,
    };
    try {
      await this.insert('documents', { ...rec });
    } catch (err) {
      await this.db.deleteFile(file_ref).catch(() => undefined);
      throw err;
    }
    return rec;
  }

  async getDocument(id: string): Promise<DocumentRecord | undefined> {
    return (await this.select<DocumentRecord>('documents', 'WHERE id = ?', [id]))[0];
  }
  listDocuments(): Promise<DocumentRecord[]> {
    return this.select<DocumentRecord>('documents', 'ORDER BY updated_at DESC, id DESC');
  }
  async getDocumentPdf(doc: Pick<DocumentRecord, 'id' | 'file_ref'>): Promise<Uint8Array> {
    return this.getSealedFile('documents', doc.id, doc.file_ref);
  }

  /** Deletes the document, its placements and exports (FK cascade) and their files. */
  async deleteDocument(id: string): Promise<void> {
    const refs = await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ file_ref: string }>(
        'SELECT file_ref FROM documents WHERE id = ? UNION ALL SELECT file_ref FROM exports WHERE document_id = ?',
        [id, id],
      );
      await tx.exec('DELETE FROM documents WHERE id = ?', [id]);
      return rows.map((r) => r.file_ref);
    });
    for (const ref of refs) await this.db.deleteFile(ref).catch(() => undefined);
  }

  async addExport(input: {
    documentId: string;
    pdf: Uint8Array;
    signerName?: string;
  }): Promise<ExportRecord> {
    const id = uuidv7();
    const file_ref = await this.putSealedFile('exports', id, input.pdf, 'export.pdf');
    const rec: ExportRecord = {
      id,
      document_id: input.documentId,
      file_ref,
      sha256: await sha256Hex(input.pdf),
      signer_name: input.signerName ?? null,
      created_at: this.now(),
    };
    try {
      await this.insert('exports', { ...rec });
    } catch (err) {
      await this.db.deleteFile(file_ref).catch(() => undefined);
      throw err;
    }
    return rec;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const enc = await this.encryptRow('settings', { key, value });
    await this.db.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, enc.value],
    );
  }
  async getSetting(key: string): Promise<string | undefined> {
    return (await this.select<{ value: string }>('settings', 'WHERE key = ?', [key]))[0]?.value;
  }

  /* ------------------------------ backup support ------------------------------ */

  /** Everything, decrypted. Files are keyed by their current ref. */
  async dumpPlain(): Promise<PlainDump> {
    const tables = {} as Record<TableName, Row[]>;
    const files = new Map<string, Uint8Array>();
    for (const t of TABLES) {
      const rows = await this.select(t, `ORDER BY ${KEY_COLUMN[t]}`);
      tables[t] = rows;
      for (const col of FILE_COLUMNS[t] ?? []) {
        for (const r of rows) {
          const ref = r[col];
          if (typeof ref !== 'string' || files.has(ref)) continue;
          files.set(ref, await this.getSealedFile(t, String(r.id), ref));
        }
      }
    }
    const v = await this.db.query<{ v: number }>('SELECT max(version) AS v FROM schema_migrations');
    return { schemaVersion: v[0]?.v ?? 0, tables, files };
  }

  /**
   * Replaces all user data with `dump` atomically: new files are written first, then every row is
   * replaced in one transaction (re-encrypted, file refs remapped), then the old files are removed.
   * On any failure the transaction rolls back, the new files are removed, and the old data stays.
   */
  async replaceAll(dump: PlainDump, opts: { confirmReplaceAll: true }): Promise<void> {
    // PM #68: never a silent replace. The UI shows the destructive confirm sheet first.
    if ((opts as { confirmReplaceAll?: unknown } | undefined)?.confirmReplaceAll !== true)
      throw new RestoreNotConfirmedError('replacing all data needs an explicit confirmation');
    const newRefs: string[] = [];
    let oldRefs: string[] = [];
    try {
      await this.db.transaction(async (tx) => {
        for (const t of TABLES) {
          for (const col of FILE_COLUMNS[t] ?? []) {
            const rows = await tx.query<Record<string, unknown>>(
              `SELECT ${col} AS r FROM ${t} WHERE ${col} IS NOT NULL`,
            );
            oldRefs.push(...rows.map((r) => String(r.r)));
          }
        }
        for (const t of [...TABLES].reverse()) await tx.exec(`DELETE FROM ${t}`);
        for (const t of TABLES) {
          for (const row of dump.tables[t]) {
            const out: Row = { ...row };
            for (const col of FILE_COLUMNS[t] ?? []) {
              const ref = row[col];
              if (typeof ref !== 'string') continue;
              const bytes = dump.files.get(ref);
              if (!bytes) throw new StorageError(`missing file for ${t}.${col}`);
              const nref = await this.putSealedFile(t, String(row.id), bytes, ref, tx);
              newRefs.push(nref);
              out[col] = nref;
            }
            await this.insert(t, out, tx);
          }
        }
      });
    } catch (err) {
      for (const r of newRefs) await this.db.deleteFile(r).catch(() => undefined);
      oldRefs = [];
      throw err;
    }
    for (const r of oldRefs) await this.db.deleteFile(r).catch(() => undefined);
  }
}
