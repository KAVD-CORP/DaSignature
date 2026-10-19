import { describe, expect, it } from 'vitest';
import { STORAGE_BACKENDS } from './index.ts';

describe('@dasignature/storage', () => {
  it('declares one local backend per platform family', () => {
    expect(Object.keys(STORAGE_BACKENDS).sort()).toEqual(['desktop', 'mobile', 'web']);
  });
});
