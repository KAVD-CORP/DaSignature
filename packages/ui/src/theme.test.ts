import { describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme, THEME_ATTRIBUTE, type ThemeTarget } from './theme.ts';

function fakeRoot(): ThemeTarget & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (n, v) => attrs.set(n, v),
    removeAttribute: (n) => attrs.delete(n),
  };
}

describe('theme', () => {
  it('follows the system by default', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('honours explicit choices regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('sets and clears the data-theme attribute', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    expect(root.attrs.get(THEME_ATTRIBUTE)).toBe('dark');
    applyTheme('system', root);
    expect(root.attrs.has(THEME_ATTRIBUTE)).toBe(false);
  });
});
