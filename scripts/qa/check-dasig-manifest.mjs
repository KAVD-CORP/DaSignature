#!/usr/bin/env node
// BAK-01-C13/C11 for a real .dasig file (e.g. produced by the app in an e2e run): PM #67 strict manifest allowlist,
// PM #18/#66 KDF params, cipher id. No dependencies (stored or deflated ZIP entries). Mirrors MANIFEST_ALLOWED in
// qa/contract/storage/backup-contract.ts; keep the two in sync. Exit 0 PASS, 1 FAIL, 2 usage/unreadable.
// Usage: node check-dasig-manifest.mjs <file.dasig> [--json]
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
const ALLOWED = [
  ['format version', /^(formatVersion|format_version|version)$/],
  ['format identifier (constant)', /^format$/],
  ['app version', /^(appVersion|app_version|app\.version)$/],
  ['created_at', /^(createdAt|created_at)$/],
  ['KDF id', /^(kdf|kdfId|kdf_id|kdf\.(id|alg|algorithm|name))$/],
  ['KDF params', /^(kdf|kdfParams)\.(memoryKiB|memory|m|iterations|t|parallelism|p|hash|prf|digest|keyLength|dkLen|hashLength|version)$/],
  ['salt', /^(salt|kdf\.salt|kdfParams\.salt)$/],
  ['IV/nonce info', /^((iv|nonce)s?(\.(\d+|length|bytes|size|prefix|base|scheme|mode))*|(iv|nonce)(Length|Bytes|Size|Prefix|Scheme|Mode))$/],
  ['cipher id', /^(cipher|cipherId|cipher_id)$/],
];
const file = process.argv[2]; const asJson = process.argv.includes('--json');
if (!file) { console.error('usage: check-dasig-manifest.mjs <file.dasig> [--json]'); process.exit(2); }
function zipEntry(buf, want) {
  for (let i = 0; i + 30 <= buf.length; ) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8), csize = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nlen), start = i + 30 + nlen + xlen, data = buf.subarray(start, start + csize);
    if (name === want) return method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    i = start + csize;
  }
  return null;
}
let raw, m;
try { raw = zipEntry(readFileSync(file), 'manifest.json'); if (!raw) throw new Error('no manifest.json entry'); m = JSON.parse(raw.toString('utf8')); }
catch (e) { console.error(`unreadable: ${e.message}`); process.exit(2); }
const flat = (v, p = '') => v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => flat(x, p ? `${p}.${k}` : k)) : [[p, v]];
const leaves = flat(m), out = [];
const add = (ok, msg) => out.push({ status: ok ? 'PASS' : 'FAIL', msg });
const extra = leaves.filter(([p]) => !ALLOWED.some(([, re]) => re.test(p)));
add(extra.length === 0, extra.length ? `keys not allowed by PM #67: ${extra.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join(', ')}` : `all ${leaves.length} manifest keys are PM #67 fields`);
for (const req of ['format version', 'app version', 'created_at', 'KDF id', 'salt', 'cipher id'])
  add(leaves.some(([p]) => ALLOWED.some(([item, re]) => item.startsWith(req) && re.test(p))), `required field: ${req}`);
const get = (re) => leaves.find(([p]) => re.test(p))?.[1];
const alg = String(get(/^(kdf\.(alg|id|algorithm|name)|kdf|kdfId|kdf_id)$/));
const it = Number(get(/^(kdf|kdfParams)\.(iterations|t)$/)), mem = Number(get(/^(kdf|kdfParams)\.(memoryKiB|memory|m)$/)), par = Number(get(/^(kdf|kdfParams)\.(parallelism|p)$/));
add(alg === 'argon2id' ? mem === 65536 && it === 3 && par === 1 : /pbkdf2/i.test(alg) && it === 600000, `KDF = PM #18 (got ${alg} m=${mem} t=${it} p=${par})`);
add(/^AES-?256-?GCM$/i.test(String(get(/^(cipher|cipherId|cipher_id)$/))), `cipher id = AES-256-GCM (got ${String(get(/^(cipher|cipherId|cipher_id)$/))})`);
const fail = out.some((r) => r.status === 'FAIL');
if (asJson) console.log(JSON.stringify({ file, manifest: m, results: out, verdict: fail ? 'FAIL' : 'PASS' }, null, 2));
else { console.log(JSON.stringify(m)); for (const r of out) console.log(`${r.status} ${r.msg}`); console.log(`VERDICT: ${fail ? 'FAIL' : 'PASS'}`); }
process.exit(fail ? 1 : 0);
