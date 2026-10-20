import { create } from 'zustand';
import { THEME_PREFERENCES, type ThemePreference } from '@dasignature/ui';
import type { DataStore } from '@dasignature/storage';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const KEY = 'theme';
let persistTo: DataStore | undefined;

/** Theme preference. Defaults to "system" (SPEC Sec 1.5); saved in the settings table. */
export const useThemeStore = create<ThemeState>()((set) => ({
  preference: 'system',
  setPreference: (preference) => {
    set({ preference });
    void persistTo?.setSetting(KEY, preference).catch(() => undefined);
  },
}));

export async function loadTheme(store: DataStore): Promise<void> {
  persistTo = store;
  const v = await store.getSetting(KEY).catch(() => undefined);
  if (v && (THEME_PREFERENCES as readonly string[]).includes(v))
    useThemeStore.setState({ preference: v as ThemePreference });
}
