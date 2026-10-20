# `.dasig` backup format, version 1

This is the canonical specification of DaSignature's backup file (SPEC Sec 6, Sec 10: "encrypted ZIP
with JSON manifest, documented open format"). The reference implementation is
`packages/storage/src/backup.ts` (`DASIG_VERSION`, `DASIG_CIPHER`, `CHUNK_SIZE`, `MANIFEST_FIELDS`).
`docs/dasig-format.md` only points here. PM decisions: #18 (crypto), #66 (KDF and salt),
#67 (plaintext manifest), #68 (restore replaces), #69 (newer versions are refused).

The same file is produced and accepted on every platform (web, Android, iOS, desktop). Everything
runs locally with WebCrypto and a bundled Argon2 WASM; nothing goes over the network.

## 1. Container

A `.dasig` file is a ZIP archive whose entries are **stored** (method 0, no compression), with
exactly these entries:

| Entry           | Content                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `manifest.json` | Plaintext JSON, section 2.                                                                                |
| `payload.bin`   | The encrypted payload, section 4.                                                                         |
| `README.txt`    | A short human-readable note ("DaSignature backup ... Format: docs/backup-format.md"). Ignored by readers. |

Readers are strict: the end-of-central-directory record must be at the very end of the file (no
trailing bytes), local and central headers must agree, every CRC-32 must match, entries must be
contiguous with no gaps, and any other entry name is rejected. A file without `manifest.json` is
"not a DaSignature backup" (`BackupFormatError`).

## 2. `manifest.json` (plaintext)

PM #67: the manifest holds **only** the fields below. No counts, titles, names, ids, hashes or any
other user content. Readers reject a v1 manifest with any additional field.

```json
{
  "version": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-10-19T22:00:00.000Z",
  "kdf": { "alg": "argon2id", "memoryKiB": 65536, "iterations": 3, "parallelism": 1 },
  "salt": "base64, 16 bytes",
  "iv": "base64, 12 bytes",
  "cipher": "AES-256-GCM"
}
```

| Field        | Type         | Meaning                                                                                                                                                |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`    | integer >= 1 | Format version. This document is version **1**.                                                                                                        |
| `appVersion` | string       | Version of the app that wrote the file (informational).                                                                                                |
| `createdAt`  | string       | ISO-8601 timestamp with offset (UTC `Z`), when the backup was made.                                                                                    |
| `kdf`        | object       | KDF id and parameters, without the salt. Either `{"alg":"argon2id","memoryKiB","iterations","parallelism"}` or `{"alg":"pbkdf2-sha256","iterations"}`. |
| `salt`       | string       | Base64 KDF salt, 16 random bytes, fresh for every backup (PM #66).                                                                                     |
| `iv`         | string       | Base64 96-bit **base nonce**, random for every backup (section 4).                                                                                     |
| `cipher`     | string       | Always `AES-256-GCM` (PM #18).                                                                                                                         |

The data schema version and all counts are inside the encrypted payload, not here.

## 3. Key derivation

PM #18/#66. The backup password (UTF-8 of its Unicode NFC normal form) and the salt give a 32-byte
key:

- **argon2id** (default): m = 65536 KiB (64 MiB), t = 3, p = 1, 32-byte output.
- **pbkdf2-sha256** (fallback where WebAssembly is unavailable): 600,000 iterations, 32-byte output.

The key is used as an AES-256-GCM key. To refuse hostile files, readers accept only Argon2id with
8 <= m <= 1,048,576 KiB, 1 <= t <= 64, 1 <= p <= 16; PBKDF2 with 1 to 10,000,000 iterations; and a
salt of 8 to 64 bytes.

## 4. `payload.bin`

```
payload.bin = keyCheck (16 bytes) || chunk_0 || chunk_1 || ... || chunk_(n-1)
```

The plaintext (the inner archive, section 5) is split into chunks of `CHUNK_SIZE` = 1 MiB
(1,048,576 bytes); the last chunk may be shorter, and an empty plaintext is one empty chunk. Each
chunk is sealed with AES-256-GCM (128-bit tag), so every sealed chunk except the last is exactly
1 MiB + 16 bytes. The chunk size is fixed for format v1 (it is not in the manifest).

**Nonces.** Let `base` be the 12 bytes of `iv`. The nonce for counter `c` is `base` with its last
4 bytes (big-endian uint32) XORed with `c`. Chunk `i` uses counter `i`; the key check uses counter
`0xFFFFFFFF`. A fresh random salt (hence key) and base nonce per backup means no (key, nonce) pair
repeats.

**Key check.** `keyCheck` is the 16-byte GCM tag of sealing the empty plaintext with counter
`0xFFFFFFFF` and AAD `dasig/v1/keycheck/<salt>` (the manifest's base64 salt string). A tag that fails
to verify means **wrong password** (`BackupPasswordError`); this is checked before any chunk, so a
wrong password and a damaged file are told apart.

**Chunk AAD.** Chunk `i` is sealed with the UTF-8 AAD

```
dasig/v1/chunk/<i>/<last|more>/<sha256-hex of the exact manifest.json bytes>
```

`last` marks the final chunk. This binds every chunk to its position, detects truncation and
reordering, and authenticates the plaintext manifest: changing any manifest byte makes decryption
fail.

## 5. Inner archive (encrypted)

The decrypted payload is a ZIP (deflate allowed) containing:

- `data.json`: `{"schemaVersion": <int>, "tables": {<table>: [<row>, ...]}}` with every table of
  SPEC Sec 6 (`documents`, `signatures`, `placements`, `exports`, `pen_presets`, `templates`,
  `settings`) as decrypted row objects with the database column names. `schema_migrations` is not
  included.
- `files/<ref>`: the decrypted bytes of every file a row points to (`documents.file_ref`,
  `exports.file_ref`, `signatures.image_ref`). Original PDFs are stored byte-for-byte (AC3).
  `<ref>` is an opaque id (a UUID, **no extension**, PM #71); the file type is known only from the
  row that points to it. Older backups may contain `<uuid>.pdf` / `<uuid>.png` names; readers
  accept them and restore re-issues opaque refs. Nothing outside the encrypted payload names a file.

## 6. Versioning and rejection rules

A reader, in this order, before touching any stored data:

1. Container rules (section 1). Failure: `BackupCorruptError` (or `BackupFormatError` with no manifest).
2. `version` must be an integer >= 1. If it is **greater than** the version the app writes, the file
   is refused with `BackupVersionError` (PM #69; message key `storage.updateRequired.backup`,
   "Update DaSignature to open this backup."). A non-integer is corrupt.
3. Manifest fields exactly as in section 2 (extra fields, bad KDF parameters, other cipher: corrupt).
4. Key check (wrong password: `BackupPasswordError`), then every chunk (any failure: corrupt).
5. `data.json`: `schemaVersion` greater than the app's database schema version is refused with
   `BackupVersionError` (PM #69). At M2 the only schema version is 1; restoring an older schema
   version (migrating its rows forward) is added together with schema version 2. Every table
   must be present, every referenced file present, and every `documents`/`exports` file's SHA-256
   must equal its `sha256` column. Unknown columns are corrupt.

Older format versions stay readable forever: when version 2 exists, committed v1 fixtures must still
restore (QA BAK-01-C10).

## 7. Restore semantics

PM #68: restore **replaces all data** (merge is a v1.1 item). There is no silent replace: the storage
API (`restoreBackup`) requires an explicit confirmation, either `{ confirmReplaceAll: true }` or the
confirm-sheet callback, which is asked exactly once after the file has been fully decrypted and
validated and before anything is written. Cancel changes nothing (`RestoreNotConfirmedError`).
The replace is atomic: new files are written, all rows are replaced in one transaction (re-encrypted
with this device's key; file refs are re-issued), then the old files are deleted. On any failure the
transaction rolls back and the new files are removed, so the existing data is untouched.

## 8. Writing a backup

`createBackup` dumps every table and file decrypted, writes the inner archive, then encrypts it with
a fresh salt and base nonce using the Argon2id parameters of section 3. Two backups of the same data
with the same password therefore differ in salt, nonce and every ciphertext byte.
