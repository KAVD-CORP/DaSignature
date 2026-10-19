import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP } from '../web/csp.ts';

interface TauriConf {
  productName: string;
  identifier: string;
  build: { frontendDist: string };
  app: { security: { csp: string; dangerousDisableAssetCspModification: string[] } };
}

const conf = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as TauriConf;

/** Tauri's own IPC channel is the only addition to the web CSP. */
const TAURI_IPC = 'ipc: http://ipc.localhost';

describe('Tauri shell config', () => {
  it('wraps the shared web build', () => {
    expect(conf.build.frontendDist).toBe('../../web/dist');
    expect(conf.productName).toBe('DaSignature');
  });

  it('uses the PM decision #1 CSP plus only the Tauri IPC origin', () => {
    const expected = CSP.replace(
      "connect-src 'self' blob: data:",
      `connect-src 'self' blob: data: ${TAURI_IPC}`,
    );
    expect(conf.app.security.csp).toBe(expected);
    expect(conf.app.security.csp.replace(TAURI_IPC, '')).not.toMatch(/https?:|\*/);
  });

  it("keeps style-src 'unsafe-inline' effective (no Tauri nonce injection)", () => {
    expect(conf.app.security.dangerousDisableAssetCspModification).toEqual(['style-src']);
  });
});
