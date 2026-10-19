import { describe, expect, it } from 'vitest';
import { APP_NAME, PLATFORMS, producerString } from './index.ts';

describe('@dasignature/core', () => {
  it('uses the exact product name', () => {
    expect(APP_NAME).toBe('DaSignature');
  });
  it('builds the PDF producer string', () => {
    expect(producerString('1.2.3')).toBe('DaSignature 1.2.3');
  });
  it('targets all six platforms', () => {
    expect(PLATFORMS).toHaveLength(6);
  });
});
