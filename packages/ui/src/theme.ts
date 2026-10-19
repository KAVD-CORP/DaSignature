import type { ResolvedTheme } from './tokens.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Minimal element surface used by applyTheme, so it is testable without a DOM. */
export interface ThemeTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export const THEME_ATTRIBUTE = 'data-theme';

/** Resolve a preference to the theme actually shown. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Apply a preference to the root element. "system" removes the attribute so the
 * prefers-color-scheme media query in tokens.css takes over (and tracks live changes).
 */
export function applyTheme(preference: ThemePreference, target: ThemeTarget): void {
  if (preference === 'system') target.removeAttribute(THEME_ATTRIBUTE);
  else target.setAttribute(THEME_ATTRIBUTE, preference);
}
