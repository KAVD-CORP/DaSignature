/**
 * Strict reader for the outer .dasig ZIP. General-purpose unzippers are lenient (they skip local
 * headers, ignore CRCs, tolerate trailing bytes), so a damaged file could still "open". The outer
 * container must be exactly what createBackup writes: stored entries, no data descriptors, no
 * comment, local and central headers agreeing, CRC-32 verified, no gaps or trailing bytes.
 * (The payload itself is additionally authenticated by AES-GCM.)
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipFormatError extends Error {
  override name = 'ZipFormatError';
}

export function strictUnzipStored(file: Uint8Array): Map<string, Uint8Array> {
  const fail = (why: string): never => {
    throw new ZipFormatError(why);
  };
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const n = file.length;
  if (n < 22) fail('too short');
  const eocd = n - 22;
  if (v.getUint32(eocd, true) !== 0x06054b50) fail('no end-of-central-directory record at the end');
  const entries = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOff = v.getUint32(eocd + 16, true);
  if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0)
    fail('multi-disk archive');
  if (v.getUint16(eocd + 8, true) !== entries || v.getUint16(eocd + 20, true) !== 0)
    fail('unexpected EOCD fields');
  if (cdOff + cdSize !== eocd) fail('central directory does not end at the EOCD');

  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = new Map<string, Uint8Array>();
  let local = 0;
  let cd = cdOff;
  for (let i = 0; i < entries; i++) {
    if (cd + 46 > eocd || v.getUint32(cd, true) !== 0x02014b50) fail('bad central header');
    const cFlags = v.getUint16(cd + 8, true);
    const cMethod = v.getUint16(cd + 10, true);
    const cCrc = v.getUint32(cd + 16, true);
    const cSize = v.getUint32(cd + 20, true);
    const uSize = v.getUint32(cd + 24, true);
    const nameLen = v.getUint16(cd + 28, true);
    const extraLen = v.getUint16(cd + 30, true);
    const commentLen = v.getUint16(cd + 32, true);
    const lOff = v.getUint32(cd + 42, true);
    const cName = file.subarray(cd + 46, cd + 46 + nameLen);
    cd += 46 + nameLen + extraLen + commentLen;
    if (cd > eocd) fail('central header overruns');
    if (lOff !== local) fail('gap or overlap before a local header');
    if (cMethod !== 0 || cSize !== uSize || (cFlags & ~0x800) !== 0)
      fail('only stored entries without descriptors are allowed');

    if (local + 30 > cdOff || v.getUint32(local, true) !== 0x04034b50) fail('bad local header');
    const lFlags = v.getUint16(local + 6, true);
    const lMethod = v.getUint16(local + 8, true);
    const lCrc = v.getUint32(local + 14, true);
    const lcSize = v.getUint32(local + 18, true);
    const luSize = v.getUint32(local + 22, true);
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const lName = file.subarray(local + 30, local + 30 + lNameLen);
    if (
      lFlags !== cFlags ||
      lMethod !== cMethod ||
      lCrc !== cCrc ||
      lcSize !== cSize ||
      luSize !== uSize
    )
      fail('local and central headers disagree');
    if (lNameLen !== nameLen || !lName.every((b, k) => b === cName[k]))
      fail('local and central names disagree');
    const dataStart = local + 30 + lNameLen + lExtraLen;
    const data = file.subarray(dataStart, dataStart + cSize);
    if (dataStart + cSize > cdOff) fail('entry overruns the central directory');
    if (crc32(data) !== cCrc) fail('CRC mismatch');
    let name: string;
    try {
      name = dec.decode(cName);
    } catch {
      return fail('entry name is not UTF-8');
    }
    if (out.has(name)) fail('duplicate entry');
    out.set(name, data);
    local = dataStart + cSize;
  }
  if (local !== cdOff) fail('bytes between the last entry and the central directory');
  if (cd !== eocd) fail('central directory size mismatch');
  return out;
}
