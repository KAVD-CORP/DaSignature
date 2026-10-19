import { describe, expect, it } from 'vitest';
import config from './capacitor.config.ts';

describe('Capacitor shell config', () => {
  it('wraps the web build', () => {
    expect(config.webDir).toBe('../web/dist');
    expect(config.appName).toBe('DaSignature');
  });
  it('never loads a remote server URL', () => {
    expect(config.server?.url).toBeUndefined();
  });
});
