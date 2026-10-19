import { create } from 'zustand';
import type { ThemePreference } from '@dasignature/ui';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Theme preference. Defaults to "system" (SPEC Sec 1.5). In-memory until the
 * settings table lands (M2/M7); see docs/decisions.md.
 */
export const useThemeStore = create<ThemeState>()((set) => ({
  preference: 'system',
  setPreference: (preference) => {
    set({ preference });
  },
}));
