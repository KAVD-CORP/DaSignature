import type { TableName } from './schema.ts';

/**
 * What is encrypted at rest (PM #17, #38). Everything not listed is stored in plaintext:
 * ids, timestamps, page_count, status, geometry, kind/source/font/colour, pen presets,
 * document and export sha256 (see docs/privacy.md), and settings other than signer_name.
 */
export const ENCRYPTED_COLUMNS: Readonly<Record<TableName, readonly string[]>> = {
  documents: ['title'],
  signatures: ['name', 'strokes_json', 'svg_path', 'typed_text'],
  placements: ['data_json'],
  exports: ['signer_name'],
  pen_presets: [],
  templates: ['name', 'placements_json'],
  settings: [], // per key, see ENCRYPTED_SETTINGS
};

/** Settings whose value is encrypted. */
export const ENCRYPTED_SETTINGS: readonly string[] = ['signer_name'];

/** Columns that hold a file ref; the file content is always sealed (PDFs, exports, signature images). */
export const FILE_COLUMNS: Readonly<Partial<Record<TableName, readonly string[]>>> = {
  documents: ['file_ref'],
  exports: ['file_ref'],
  signatures: ['image_ref'],
};

/** Primary key column per table (the row id in the AAD). */
export const KEY_COLUMN: Readonly<Record<TableName, string>> = {
  documents: 'id',
  signatures: 'id',
  placements: 'id',
  exports: 'id',
  pen_presets: 'id',
  templates: 'id',
  settings: 'key',
};
