# Privacy and data at rest

DaSignature is local-first: there are no accounts, no servers, no analytics and no network calls
at runtime (SPEC Sec 5, PM #1). Your documents and signatures stay on your device. This page says
exactly what is stored, where, and what is encrypted, and what leaves the app (only what you
export or share yourself).

**The app sends nothing; the website's guide pages are separate.** The public help articles under
`/guides` on the website (how-to pages about signing PDFs, which are not part of the app) may use
cookieless page analytics, and only if the site owner has turned it on (decided Oct 26,
decisions.md E-112). It counts page views and clicks on "Open the app" links; it keeps nothing in
cookies or browser storage, records no sessions, and does not run at all if your browser sends Do
Not Track or Global Privacy Control. None of it is ever loaded by the app itself, which stays
analytics-free with no network calls; a build check fails if any analytics code reaches the app.

## Where data lives

| Platform            | Database                                                  | Files (PDFs, exports, signature images) | Data key                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web / PWA           | SQLite (WASM) in the browser's Origin Private File System | OPFS                                    | Wrapped in IndexedDB (see "Keys")                                                                                                                                                                              |
| Desktop (Tauri)     | SQLCipher database in the app-data folder                 | `files/` in the app-data folder         | Database key in the OS credential store (Keychain, Windows Credential Manager, Secret Service); the column data key is a separate entry in the same store, read through the `secure_key_get_or_create` command |
| Android (Capacitor) | SQLCipher database in the app's private storage           | App sandbox (`files/dasig`)             | Random 32-byte secrets wrapped by an Android Keystore AES-GCM key (private SharedPreferences); `allowBackup=false`                                                                                             |
| iOS (Capacitor)     | v1.0: the web engine inside WKWebView (see Web / PWA)     | WKWebView origin storage                | As Web / PWA (a native Keychain plugin is planned)                                                                                                                                                             |

Nothing is written to `localStorage`, cookies or any remote service.

**File names reveal nothing (PM #71).** Every stored file (original PDF, signed copy, signature
image) is named with a random id and no extension, on every platform and inside backups. Whether a
file is a PDF or an image is known only from the encrypted database row that points to it, and the
file contents are encrypted, so a directory listing shows only random names.

## What is encrypted

Every platform applies the same column encryption (PM #17, #38, #65): AES-256-GCM with a 96-bit
random IV per value, and each value bound to its table, column and row (so values can't be swapped
between rows). On desktop and mobile the whole database is additionally encrypted by SQLCipher.

**Encrypted:**

- document titles (`documents.title`)
- every stored file: original PDFs, exported (signed) PDFs, signature images
- signatures: name, strokes, SVG path, typed text (`signatures.name`, `strokes_json`, `svg_path`, `typed_text`)
- placement data (`placements.data_json`, e.g. date and text field content)
- the signer name on exports (`exports.signer_name`) and the signer-name setting
- templates: name and placements (`templates.name`, `templates.placements_json`)

**Stored in plaintext** (needed to list, sort and check data without the key, and not user content):

- ids, created/updated timestamps, page counts, document status
- **the SHA-256 hashes of documents and exports (`documents.sha256`, `exports.sha256`) are stored
  in plaintext.** They are needed for the integrity check (the original PDF is never modified,
  AC3) and are shown in the audit view. This is an accepted risk (PM #38): someone who can read
  your device's storage and already has a copy of a particular PDF could confirm that you stored
  it. The hash does not reveal the document's content.
- placement geometry (page, position, size, rotation, opacity), signature kind/source/font/colour
- pen presets (stroke settings, not sensitive)
- settings other than the signer name (theme, language, auto-lock), and the schema version

## Keys

- **Web, no passcode:** a random 256-bit data key, wrapped (AES-KW) by a non-extractable key that
  the browser keeps in IndexedDB. The raw data key is never written anywhere. This protects your
  data from anyone reading the stored files, but anyone who can run this browser profile as you
  can open the app.
- **Web, App lock passcode:** the wrapping key is derived from your passcode with Argon2id
  (64 MiB, 3 iterations; PBKDF2-SHA256 600,000 as a fallback, PM #18). Without the passcode the data
  can't be decrypted. Auto-lock after Immediately / 1 / 5 (default) / 15 / 30 minutes / Never (PM #19)
  drops the key from memory.
- **Desktop / mobile:** keys are generated on first launch and kept in the operating system's
  credential store; they are never in the app's data folder. If the credential store is
  unavailable, the app refuses to start the storage rather than store the key insecurely.

If you lose the passcode or the OS credential store is reset, the local data can't be recovered;
keep a backup.

## Backups

A `.dasig` backup is always encrypted with a password you choose (Argon2id with a fresh random
salt per backup, AES-256-GCM). Its only plaintext part is a small manifest with the format version,
app version, creation time, KDF parameters, salt, nonce and cipher name: no titles, names, counts or
hashes (PM #67). Restoring replaces all data on the device after you confirm (PM #68). The format
is documented in [backup-format.md](./backup-format.md).

## What leaves the app

Nothing, unless you do it:

- **Export / Save** writes the signed copy where you choose (download, native Save dialog, or the
  Android document picker).
- **Share** hands the signed copy to the app you pick in the OS share sheet.
- **Backup** writes an encrypted `.dasig` file where you choose.

The app has no network permission on Android, and on every platform the Content-Security-Policy
allows only same-origin resources. The Windows installer may download Microsoft WebView2 during
setup if it isn't installed yet. That is the installer, not the app.

## Removing your data

Settings › Clear all data deletes every document, signature, signed copy and setting. Uninstalling the desktop or mobile app removes its data folder. On Linux/Windows
the database key stays in the OS keyring under "DaSignature" until you remove it there.
