import { randomBytes } from './bytes.ts';

/** RFC 9562 UUID version 7: 48-bit Unix ms timestamp, then random bits (SPEC Sec 6: ids are uuid v7). */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70; // version 7
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
