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

export interface SignatureRecord {
  id: string;
  kind: 'signature' | 'initials';
  source: 'draw' | 'type' | 'image' | 'scan';
  name: string;
  strokes_json: string | null;
  svg_path: string | null;
  image_ref: string | null;
  typed_text: string | null;
  font_id: string | null;
  color: string | null;
  opacity: number | null;
  is_default: number;
  created_at: string;
}

export type NewSignature = Omit<
  SignatureRecord,
  'id' | 'image_ref' | 'is_default' | 'created_at'
> & {
  /** PNG bytes for upload/scan signatures (stored as a sealed file). */
  image?: Uint8Array;
  isDefault?: boolean;
};

export interface PlacementRecord {
  id: string;
  document_id: string;
  page_index: number;
  type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox' | 'annotation';
  signature_id: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  data_json: string | null;
  z_index: number;
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

  /** Updates columns of one row (encrypting per the field map). */
  async update(
    table: TableName,
    id: string,
    patch: Row,
    db: StorageAdapter = this.db,
  ): Promise<void> {
    const key = KEY_COLUMN[table];
    const enc = await this.encryptRow(table, { ...patch, [key]: id });
    const cols = Object.keys(enc).filter((c) => c !== key);
    if (cols.length === 0) return;
    if (!cols.every((c) => IDENT.test(c))) throw new StorageError('bad column name');
    await db.exec(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${key} = ?`,
      [...cols.map((c) => enc[c]), id],
    );
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

  /* ------------------------------ signatures ------------------------------ */

  listSignatures(): Promise<SignatureRecord[]> {
    return this.select<SignatureRecord>('signatures', 'ORDER BY created_at DESC, id DESC');
  }
  async getSignature(id: string): Promise<SignatureRecord | undefined> {
    return (await this.select<SignatureRecord>('signatures', 'WHERE id = ?', [id]))[0];
  }

  /** Saves a signature; the first of its kind (or `isDefault`) becomes the kind's default. */
  async addSignature(input: NewSignature): Promise<SignatureRecord> {
    const id = uuidv7();
    const { image, isDefault, ...fields } = input;
    const image_ref = image ? await this.putSealedFile('signatures', id, image, 'sig') : null;
    const rec: SignatureRecord = {
      ...fields,
      id,
      image_ref,
      is_default: 0,
      created_at: this.now(),
    };
    try {
      await this.db.transaction(async (tx) => {
        const others = await tx.query<{ n: number }>(
          'SELECT count(*) AS n FROM signatures WHERE kind = ? AND is_default = 1',
          [input.kind],
        );
        const makeDefault = isDefault === true || (others[0]?.n ?? 0) === 0;
        if (makeDefault) {
          await tx.exec('UPDATE signatures SET is_default = 0 WHERE kind = ?', [input.kind]);
          rec.is_default = 1;
        }
        await this.insert('signatures', { ...rec }, tx);
      });
    } catch (err) {
      if (image_ref) await this.db.deleteFile(image_ref).catch(() => undefined);
      throw err;
    }
    return rec;
  }

  async setDefaultSignature(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ kind: string }>('SELECT kind FROM signatures WHERE id = ?', [
        id,
      ]);
      const kind = rows[0]?.kind;
      if (!kind) return;
      await tx.exec('UPDATE signatures SET is_default = (id = ?) WHERE kind = ?', [id, kind]);
    });
  }

  async renameSignature(id: string, name: string): Promise<void> {
    await this.update('signatures', id, { name });
  }

  /** Deletes a signature (placements keep their geometry; FK sets signature_id NULL). If it was the
   * default, the most recent remaining item of the same kind becomes the default. */
  async deleteSignature(id: string): Promise<void> {
    const ref = await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ kind: string; is_default: number; image_ref: string | null }>(
        'SELECT kind, is_default, image_ref FROM signatures WHERE id = ?',
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      await tx.exec('DELETE FROM signatures WHERE id = ?', [id]);
      if (row.is_default)
        await tx.exec(
          `UPDATE signatures SET is_default = 1 WHERE id = (SELECT id FROM signatures WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT 1)`,
          [row.kind],
        );
      return row.image_ref;
    });
    if (ref) await this.db.deleteFile(ref).catch(() => undefined);
  }

  async getSignatureImage(
    sig: Pick<SignatureRecord, 'id' | 'image_ref'>,
  ): Promise<Uint8Array | undefined> {
    if (!sig.image_ref) return undefined;
    return this.getSealedFile('signatures', sig.id, sig.image_ref);
  }

  /* ------------------------------ placements ------------------------------ */

  listPlacements(documentId: string): Promise<PlacementRecord[]> {
    return this.select<PlacementRecord>(
      'placements',
      'WHERE document_id = ? ORDER BY page_index, z_index, id',
      [documentId],
    );
  }

  /** Replaces every placement of a document in one transaction (autosave of the draft). */
  async savePlacements(documentId: string, items: readonly PlacementRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM placements WHERE document_id = ?', [documentId]);
      for (const p of items) await this.insert('placements', { ...p, document_id: documentId }, tx);
      await tx.exec('UPDATE documents SET updated_at = ? WHERE id = ?', [this.now(), documentId]);
    });
  }

  async setDocumentStatus(id: string, status: 'draft' | 'signed'): Promise<void> {
    await this.db.exec('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      this.now(),
      id,
    ]);
  }

  listExports(documentId: string): Promise<ExportRecord[]> {
    return this.select<ExportRecord>('exports', 'WHERE document_id = ? ORDER BY created_at, id', [
      documentId,
    ]);
  }
  /** Integrity check: an export with exactly this SHA-256, with its document title. */
  async findExportBySha256(
    sha256: string,
  ): Promise<{ export: ExportRecord; title: string | undefined } | undefined> {
    const [exp] = await this.select<ExportRecord>('exports', 'WHERE sha256 = ? LIMIT 1', [
      sha256.toLowerCase(),
    ]);
    if (!exp) return undefined;
    return { export: exp, title: (await this.getDocument(exp.document_id))?.title };
  }
  async getExportPdf(rec: Pick<ExportRecord, 'id' | 'file_ref'>): Promise<Uint8Array> {
    return this.getSealedFile('exports', rec.id, rec.file_ref);
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
