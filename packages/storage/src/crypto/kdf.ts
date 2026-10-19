import { fromBase64, randomBytes, toArrayBuffer, toBase64, utf8 } from '../bytes.ts';

/** PM #18: Argon2id m = 64 MiB, t = 3, p = 1 (WASM, bundled, no network). */
export const ARGON2ID = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 } as const;
/** PM #18: PBKDF2-SHA256 with 600,000 iterations where Argon2id cannot run. */
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
const KEY_BYTES = 32;

export type KdfParams =
  | { alg: 'argon2id'; memoryKiB: number; iterations: number; parallelism: number; salt: string }
  | { alg: 'pbkdf2-sha256'; iterations: number; salt: string };

/** Fresh parameters with a random salt: Argon2id when WebAssembly is available, else PBKDF2. */
export function newKdfParams(prefer: 'argon2id' | 'pbkdf2-sha256' = 'argon2id'): KdfParams {
  const salt = toBase64(randomBytes(SALT_BYTES));
  if (prefer === 'argon2id' && typeof WebAssembly === 'object')
    return { alg: 'argon2id', ...ARGON2ID, salt };
  return { alg: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt };
}

/** 32 key bytes from a password. Throws on parameters outside sane bounds (hostile backups). */
export async function deriveKeyBytes(password: string, p: KdfParams): Promise<Uint8Array> {
  const salt = fromBase64(p.salt);
  if (salt.length < 8 || salt.length > 64) throw new RangeError('bad KDF salt');
  if (p.alg === 'argon2id') {
    if (p.memoryKiB > 1024 * 1024 || p.iterations > 64 || p.parallelism > 16 || p.iterations < 1)
      throw new RangeError('Argon2id parameters out of range');
    const { argon2id } = await import('hash-wasm');
    return argon2id({
      password: utf8(password.normalize('NFC')),
      salt,
      memorySize: p.memoryKiB,
      iterations: p.iterations,
      parallelism: p.parallelism,
      hashLength: KEY_BYTES,
      outputType: 'binary',
    });
  }
  if (p.iterations < 1 || p.iterations > 10_000_000)
    throw new RangeError('PBKDF2 iterations out of range');
  const base = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(utf8(password.normalize('NFC'))),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: p.iterations },
    base,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}
