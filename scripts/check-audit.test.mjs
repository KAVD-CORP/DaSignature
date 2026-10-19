import { describe, expect, it } from 'vitest';
import { checkExceptions } from './check-audit.mjs';

const ex = [{ id: 'GHSA-x', reason: 'r', approved: 'PM #54', expiresAt: 'M9' }];

describe('check-audit exceptions (PM #54)', () => {
  it('passes before expiry', () => {
    expect(checkExceptions(['GHSA-x'], ex, 'M1')).toEqual({ errors: [], warnings: [] });
  });
  it('warns one milestone before expiry', () => {
    const r = checkExceptions(['GHSA-x'], ex, 'M8');
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch(/expires at M9/);
  });
  it('fails at and after expiry', () => {
    expect(checkExceptions(['GHSA-x'], ex, 'M9').errors[0]).toMatch(/EXPIRED at M9/);
    expect(checkExceptions(['GHSA-x'], ex, 'M10').errors).toHaveLength(1);
  });
  it('fails on an undocumented ignore', () => {
    expect(checkExceptions(['GHSA-y'], ex, 'M1').errors[0]).toMatch(/not documented/);
  });
});
