// SPEC Sec 6 schema, encoded structurally for ADP-SCHEMA-01 (PRAGMA-based, so formatting/whitespace of the DDL can't matter).
import type { StorageAdapter } from './types.ts';

type Col = { name: string; type: string; notnull: 0 | 1; dflt: string | null; pk: 0 | 1 };
type FK = { from: string; table: string; to: string; on_delete: string };
export interface TableSpec { cols: Col[]; fks?: FK[] }
const c = (name: string, type: string, notnull: 0 | 1 = 0, dflt: string | null = null, pk: 0 | 1 = 0): Col => ({ name, type, notnull, dflt, pk });

export const SPEC_SCHEMA: Record<string, TableSpec> = {
  schema_migrations: { cols: [c('version', 'INTEGER', 0, null, 1), c('applied_at', 'TEXT', 1)] },
  documents: { cols: [c('id', 'TEXT', 0, null, 1), c('title', 'TEXT', 1), c('file_ref', 'TEXT', 1), c('sha256', 'TEXT', 1), c('page_count', 'INTEGER', 1), c('status', 'TEXT', 1, "'draft'"), c('created_at', 'TEXT', 1), c('updated_at', 'TEXT', 1)] },
  signatures: { cols: [c('id', 'TEXT', 0, null, 1), c('kind', 'TEXT', 1), c('source', 'TEXT', 1), c('name', 'TEXT', 1), c('strokes_json', 'TEXT'), c('svg_path', 'TEXT'), c('image_ref', 'TEXT'), c('typed_text', 'TEXT'), c('font_id', 'TEXT'), c('color', 'TEXT'), c('opacity', 'REAL'), c('is_default', 'INTEGER', 1, '0'), c('created_at', 'TEXT', 1)] },
  placements: {
    cols: [c('id', 'TEXT', 0, null, 1), c('document_id', 'TEXT', 1), c('page_index', 'INTEGER', 1), c('type', 'TEXT', 1), c('signature_id', 'TEXT'), c('x', 'REAL', 1), c('y', 'REAL', 1), c('w', 'REAL', 1), c('h', 'REAL', 1), c('rotation', 'REAL', 1, '0'), c('opacity', 'REAL', 1, '1'), c('data_json', 'TEXT'), c('z_index', 'INTEGER', 1, '0')],
    fks: [{ from: 'document_id', table: 'documents', to: 'id', on_delete: 'CASCADE' }, { from: 'signature_id', table: 'signatures', to: 'id', on_delete: 'SET NULL' }],
  },
  exports: { cols: [c('id', 'TEXT', 0, null, 1), c('document_id', 'TEXT', 1), c('file_ref', 'TEXT', 1), c('sha256', 'TEXT', 1), c('signer_name', 'TEXT'), c('created_at', 'TEXT', 1)], fks: [{ from: 'document_id', table: 'documents', to: 'id', on_delete: 'CASCADE' }] },
  pen_presets: { cols: [c('id', 'TEXT', 0, null, 1), c('name', 'TEXT', 1), c('settings_json', 'TEXT', 1)] },
  templates: { cols: [c('id', 'TEXT', 0, null, 1), c('name', 'TEXT', 1), c('placements_json', 'TEXT', 1)] },
  settings: { cols: [c('key', 'TEXT', 0, null, 1), c('value', 'TEXT', 1)] },
};
export const SPEC_INDEXES = { idx_placements_doc: { table: 'placements', cols: ['document_id', 'page_index'] } } as const;
/** Sec 6 DDL verbatim (used by reference adapters and by the migration contract as the v1 expectation). */
export const SPEC_DDL = `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE signatures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, strokes_json TEXT, svg_path TEXT, image_ref TEXT, typed_text TEXT, font_id TEXT, color TEXT, opacity REAL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE placements (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_index INTEGER NOT NULL, type TEXT NOT NULL, signature_id TEXT REFERENCES signatures(id) ON DELETE SET NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, rotation REAL NOT NULL DEFAULT 0, opacity REAL NOT NULL DEFAULT 1, data_json TEXT, z_index INTEGER NOT NULL DEFAULT 0);
CREATE TABLE exports (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, signer_name TEXT, created_at TEXT NOT NULL);
CREATE TABLE pen_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings_json TEXT NOT NULL);
CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, placements_json TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_placements_doc ON placements(document_id, page_index);`;

/** Returns a list of human-readable differences between the live schema and SPEC Sec 6 (empty = match). */
export async function diffSpecSchema(a: StorageAdapter, opts: { extraTables?: string[] } = {}): Promise<string[]> {
  const diffs: string[] = [];
  const tables = (await a.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
  for (const t of Object.keys(SPEC_SCHEMA)) if (!tables.includes(t)) diffs.push(`missing table ${t}`);
  for (const t of tables) if (!(t in SPEC_SCHEMA) && !(opts.extraTables ?? []).includes(t)) diffs.push(`extra table ${t} (allowed only if listed in extraTables and logged in docs/decisions.md)`);
  for (const [t, spec] of Object.entries(SPEC_SCHEMA)) {
    if (!tables.includes(t)) continue;
    const live = await a.query<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(`PRAGMA table_info(${t})`);
    const norm = (x: Col) => `${x.name} ${x.type.toUpperCase()} notnull=${x.notnull} dflt=${x.dflt} pk=${x.pk}`;
    const want = spec.cols.map(norm), got = live.map((x) => norm({ name: x.name, type: x.type, notnull: Number(x.notnull) as 0 | 1, dflt: x.dflt_value ?? null, pk: (Number(x.pk) > 0 ? 1 : 0) as 0 | 1 }));
    if (want.join('|') !== got.join('|')) diffs.push(`${t} columns differ:\n  want ${want.join(', ')}\n  got  ${got.join(', ')}`);
    const fks = await a.query<{ from: string; table: string; to: string; on_delete: string }>(`PRAGMA foreign_key_list(${t})`);
    const fk = (x: FK) => `${x.from}->${x.table}(${x.to}) ON DELETE ${x.on_delete.toUpperCase()}`;
    const wantFk = (spec.fks ?? []).map(fk).sort().join('|'), gotFk = fks.map((x) => fk(x)).sort().join('|');
    if (wantFk !== gotFk) diffs.push(`${t} foreign keys differ: want [${wantFk}] got [${gotFk}]`);
  }
  for (const [ix, spec] of Object.entries(SPEC_INDEXES)) {
    const cols = (await a.query<{ name: string }>(`PRAGMA index_info(${ix})`)).map((r) => r.name);
    if (cols.join(',') !== spec.cols.join(',')) diffs.push(`index ${ix} on ${spec.table}: want (${spec.cols.join(', ')}) got (${cols.join(', ') || 'missing'})`);
  }
  return diffs;
}
