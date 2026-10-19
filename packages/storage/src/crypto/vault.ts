import { DecryptionError } from '../errors.ts';
import {
  concatBytes,
  fromBase64,
  fromUtf8,
  randomBytes,
  toArrayBuffer,
  toBase64,
  utf8,
} from '../bytes.ts';

/** PM #18: AES-256-GCM, 96-bit random IV per record, 128-bit tag. Record = IV(12) ‖ ciphertext ‖ tag(16). */
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

export async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.length !== 32) throw new RangeError('AES-256 key must be 32 bytes');
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

export async function sealBytes(
  key: CryptoKey,
  plain: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: 128 },
    key,
    toArrayBuffer(plain),
  );
  return concatBytes(iv, new Uint8Array(ct));
}

export async function openBytes(
  key: CryptoKey,
  sealed: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new DecryptionError('ciphertext too short');
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(sealed.subarray(0, IV_BYTES)),
        additionalData: toArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toArrayBuffer(sealed.subarray(IV_BYTES)),
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError('decryption failed (wrong key or tampered data)');
  }
}

/**
 * Encryption at rest for fields and blobs (PM #17). The AAD binds every record to its table,
 * column and row, so a ciphertext copied into another row or column fails to decrypt.
 */
export class Vault {
  constructor(readonly key: CryptoKey) {}

  static aad(scope: string, id: string): Uint8Array {
    return utf8(`dasig/v1/${scope}/${id}`);
  }
  seal(plain: Uint8Array, scope: string, id: string): Promise<Uint8Array> {
    return sealBytes(this.key, plain, Vault.aad(scope, id));
  }
  open(sealed: Uint8Array, scope: string, id: string): Promise<Uint8Array> {
    return openBytes(this.key, sealed, Vault.aad(scope, id));
  }
  /** Text column value: base64(IV ‖ ciphertext ‖ tag). */
  async sealText(plain: string, scope: string, id: string): Promise<string> {
    return toBase64(await this.seal(utf8(plain), scope, id));
  }
  async openText(stored: string, scope: string, id: string): Promise<string> {
    let raw: Uint8Array;
    try {
      raw = fromBase64(stored);
    } catch {
      throw new DecryptionError('encrypted column is not base64');
    }
    return fromUtf8(await this.open(raw, scope, id));
  }
}
