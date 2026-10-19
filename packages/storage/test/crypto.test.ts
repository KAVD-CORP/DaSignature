import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesEqual, fromBase64, randomBytes, toBase64, utf8 } from '../src/bytes.ts';
import { ARGON2ID, deriveKeyBytes, newKdfParams, PBKDF2_ITERATIONS } from '../src/crypto/kdf.ts';
import {
  AppLock,
  AUTO_LOCK_DEFAULT,
  AUTO_LOCK_OPTIONS,
  MemoryKeyValueStore,
  NativeKeyManager,
  WebKeyManager,
} from '../src/crypto/keys.ts';
import { IV_BYTES, TAG_BYTES, Vault } from '../src/crypto/vault.ts';
import { DecryptionError, LockedError, WrongPasswordError } from '../src/errors.ts';
import { FAST_KDF, memoryStore, newVault } from './helpers.ts';

describe('KDF (PM #18)', () => {
  it('uses Argon2id m=64 MiB t=3 p=1 by default, PBKDF2-SHA256 600k as fallback', () => {
    expect(ARGON2ID).toEqual({ memoryKiB: 65536, iterations: 3, parallelism: 1 });
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const a = newKdfParams();
    expect(a).toMatchObject({ alg: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 });
    expect(fromBase64(a.salt)).toHaveLength(16);
    expect(newKdfParams('pbkdf2-sha256')).toMatchObject({
      alg: 'pbkdf2-sha256',
      iterations: 600_000,
    });
    expect(newKdfParams().salt).not.toBe(a.salt);
  });

  it('Argon2id with the production parameters is deterministic and salt/password sensitive', async () => {
    const salt = toBase64(utf8('somesaltsomesalt'));
    const p = { alg: 'argon2id' as const, ...ARGON2ID, salt };
    const k1 = await deriveKeyBytes('password', p);
    expect(k1).toHaveLength(32);
    expect(bytesEqual(k1, await deriveKeyBytes('password', p))).toBe(true);
    expect(bytesEqual(k1, await deriveKeyBytes('passwore', p))).toBe(false);
    expect(
      bytesEqual(
        k1,
        await deriveKeyBytes('password', { ...p, salt: toBase64(utf8('somesaltsomesalT')) }),
      ),
    ).toBe(false);
  }, 30_000);

  it('PBKDF2-SHA256 matches an independent implementation (node:crypto)', async () => {
    const salt = utf8('0123456789abcdef');
    const k = await deriveKeyBytes('pässwörd', {
      alg: 'pbkdf2-sha256',
      iterations: 1000,
      salt: toBase64(salt),
    });
    const ref = pbkdf2Sync(Buffer.from('pässwörd', 'utf8'), Buffer.from(salt), 1000, 32, 'sha256');
    expect(bytesEqual(k, new Uint8Array(ref))).toBe(true);
  });

  it('normalises the password to NFC (the same password typed on any OS gives the same key)', async () => {
    const p = {
      alg: 'pbkdf2-sha256',
      iterations: 1000,
      salt: toBase64(utf8('0123456789abcdef')),
    } as const;
    const nfc = await deriveKeyBytes('p\u00e4ss', p);
    const nfd = await deriveKeyBytes('pa\u0308ss', p);
    expect(bytesEqual(nfc, nfd)).toBe(true);
  });

  it('rejects hostile KDF parameters', async () => {
    await expect(
      deriveKeyBytes('x', {
        alg: 'argon2id',
        memoryKiB: 1 << 30,
        iterations: 3,
        parallelism: 1,
        salt: toBase64(randomBytes(16)),
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      deriveKeyBytes('x', {
        alg: 'pbkdf2-sha256',
        iterations: 1e9,
        salt: toBase64(randomBytes(16)),
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('Vault (AES-256-GCM, PM #18)', () => {
  it('record = IV(12) + ciphertext + tag(16); fresh IV every time', async () => {
    const v = await newVault();
    const plain = utf8('hello');
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = await v.seal(plain, 'documents.title', 'id1');
      expect(s.length).toBe(IV_BYTES + plain.length + TAG_BYTES);
      ivs.add(toBase64(s.subarray(0, IV_BYTES)));
    }
    expect(ivs.size).toBe(200);
  });

  it('binds ciphertext to table, column and row (AAD)', async () => {
    const v = await newVault();
    const s = await v.sealText('secret', 'documents.title', 'a');
    expect(await v.openText(s, 'documents.title', 'a')).toBe('secret');
    await expect(v.openText(s, 'documents.title', 'b')).rejects.toBeInstanceOf(DecryptionError);
    await expect(v.openText(s, 'templates.name', 'a')).rejects.toBeInstanceOf(DecryptionError);
    const raw = fromBase64(s);
    raw[20] = (raw[20] ?? 0) ^ 1;
    await expect(v.open(raw, 'documents.title', 'a')).rejects.toBeInstanceOf(DecryptionError);
    await expect((await newVault()).openText(s, 'documents.title', 'a')).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await expect(v.openText('not base64!', 'x', 'y')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('uses WebCrypto keys that cannot be exported unless asked', async () => {
    const v = await newVault();
    expect(v.key.extractable).toBe(false);
    expect(v.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });
});

describe('WebKeyManager (device-bound key and app-lock passcode)', () => {
  const check = async (a: Vault, b: Vault) => {
    expect(await b.openText(await a.sealText('x', 's', 'i'), 's', 'i')).toBe('x');
  };

  it('creates a DEK on first run under a non-extractable device key, and reuses it', async () => {
    const kv = new MemoryKeyValueStore();
    const km = new WebKeyManager(kv, FAST_KDF);
    expect(await km.mode()).toBe('new');
    const v1 = await km.unlock();
    expect(await km.mode()).toBe('device');
    const rec = kv.map.get('dek') as { kek: CryptoKey; wrapped: Uint8Array };
    expect(rec.kek.extractable).toBe(false);
    expect(rec.wrapped).toHaveLength(40); // AES-KW of a 32-byte key
    await check(v1, await new WebKeyManager(kv, FAST_KDF).unlock());
  });

  it('passcode on: device record replaced, wrong passcode rejected, passcode off again', async () => {
    const kv = new MemoryKeyValueStore();
    const km = new WebKeyManager(kv, FAST_KDF);
    const v = await km.unlock();
    expect(v.key.extractable).toBe(false);
    await km.setPasscode('2468');
    expect(await km.mode()).toBe('passcode');
    expect(JSON.stringify([...kv.map.keys()])).toBe('["dek"]');
    expect('kek' in (kv.map.get('dek') as object)).toBe(false);
    await expect(km.unlock()).rejects.toBeInstanceOf(LockedError);
    await expect(km.unlockWithPasscode('1357')).rejects.toBeInstanceOf(WrongPasswordError);
    await check(v, await km.unlockWithPasscode('2468'));
    await km.setPasscode('9999', '2468'); // change passcode
    await expect(km.unlockWithPasscode('2468')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(km.setPasscode('1111', 'nope')).rejects.toBeInstanceOf(WrongPasswordError);
    await km.clearPasscode('9999');
    expect(await km.mode()).toBe('device');
    await check(v, await km.unlock());
  });

  it('NativeKeyManager takes the DEK from the OS keystore', async () => {
    const secrets = new Map<string, Uint8Array>();
    const ks = {
      getOrCreateSecret: (n: string) => {
        if (!secrets.has(n)) secrets.set(n, randomBytes(32));
        return Promise.resolve(secrets.get(n) as Uint8Array);
      },
      deleteSecret: (n: string) => Promise.resolve(void secrets.delete(n)),
    };
    const a = await new NativeKeyManager(ks).unlock();
    await check(a, await new NativeKeyManager(ks).unlock());
    expect([...secrets.keys()]).toEqual(['dasig.dek']);
  });
});

describe('AppLock (storage-level lock, PM #18/#19)', () => {
  it('drops the key on lock; reads fail until unlock; a restart with a passcode stays locked', async () => {
    const kv = new MemoryKeyValueStore();
    const lock = new AppLock(new WebKeyManager(kv, FAST_KDF));
    expect(await lock.resume()).toBe(true);
    const { store } = await memoryStore(undefined, lock);
    const doc = await store.addDocument({ title: 'locked?', pdf: utf8('%PDF-x'), pageCount: 1 });
    await lock.setPasscode('2468');
    lock.lock();
    expect(lock.isUnlocked()).toBe(false);
    await expect(store.getDocument(doc.id)).rejects.toBeInstanceOf(LockedError);
    await expect(lock.unlock('0000')).rejects.toBeInstanceOf(WrongPasswordError);
    await lock.unlock('2468');
    expect((await store.getDocument(doc.id))?.title).toBe('locked?');
    const restarted = new AppLock(new WebKeyManager(kv, FAST_KDF));
    expect(await restarted.resume()).toBe(false);
    expect(() => restarted.vault()).toThrow(LockedError);
  });

  it('auto-lock options are Immediately/1/5/15/30/Never, default 5 (PM #19)', () => {
    expect([...AUTO_LOCK_OPTIONS]).toEqual([0, 1, 5, 15, 30, null]);
    expect(AUTO_LOCK_DEFAULT).toBe(5);
  });
});
