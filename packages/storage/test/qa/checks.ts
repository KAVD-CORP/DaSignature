// Shared assertion helpers (no vitest import): each returns a list of problems; [] = pass.
import { sha256hex } from './fixtures.ts';

/** PM #69: "refused, with a clear 'update DaSignature to open this' message; data is not touched". */
export const UPDATE_MESSAGE = /update DaSignature/i;
export interface UpdateRequiredSpec {
  /** Dedicated error type the implementation throws (checked via err.name, e.g. 'SchemaTooNewError'). Never plain 'Error'. */
  errorName: string;
  /** The text the USER sees for this error (e.g. i18n t(err.messageKey) in English). Defaults to err.message. */
  userMessage?(err: unknown): string;
}
export function updateRequiredProblems(err: unknown, spec: UpdateRequiredSpec): string[] {
  if (!(err instanceof Error)) return [`expected a refusal (Error), got ${err === null ? 'success' : String(err)}`];
  const p: string[] = [];
  if (spec.errorName === 'Error') p.push('harness errorName must be a dedicated type, not "Error"');
  if (err.name !== spec.errorName) p.push(`error type ${err.name} (${err.constructor.name}), expected ${spec.errorName}`);
  const msg = spec.userMessage ? spec.userMessage(err) : err.message;
  if (!UPDATE_MESSAGE.test(msg)) p.push(`user-facing message lacks "update DaSignature": ${JSON.stringify(msg)}`);
  return p;
}

export type RawFile = { path: string; bytes: Uint8Array };
/** Byte-identity of every persisted file (paths + sha256). */
export async function rawDiff(before: RawFile[], after: RawFile[]): Promise<string[]> {
  const h = async (l: RawFile[]) => new Map(await Promise.all(l.map(async (f) => [f.path, await sha256hex(f.bytes)] as const)));
  const b = await h(before), a = await h(after); const p: string[] = [];
  for (const [k, v] of b) if (!a.has(k)) p.push(`removed ${k}`); else if (a.get(k) !== v) p.push(`changed ${k}`);
  for (const k of a.keys()) if (!b.has(k)) p.push(`added ${k}`);
  return p;
}
