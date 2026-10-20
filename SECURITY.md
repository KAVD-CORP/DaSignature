# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** (Security
advisories) on this repository, not in a public issue. Include the affected version or platform,
steps to reproduce, and the impact. We aim to acknowledge reports within 7 days and to publish a
fix and an advisory once it's released.

## Scope and threat model

DaSignature keeps everything on the device. In scope:

- Data at rest: column encryption (AES-256-GCM, values bound to table/column/row), SQLCipher on
  desktop and Android, key storage (OS keyring, Android Keystore, web WebCrypto/IndexedDB with an
  optional passcode via Argon2id), backups (`.dasig`, see docs/backup-format.md).
- Any network access at runtime (there should be none), any CSP bypass, script injection through a
  crafted PDF or backup file.
- The desktop IPC surface (`apps/desktop/src-tauri/src`): commands must not read arbitrary paths.
  `opened_file_read` only reads files the OS handed to the app.

Out of scope: an attacker who already controls the unlocked device or the OS account, and the
legal validity of simple electronic signatures.

## Supported versions

Only the latest release gets security fixes.
