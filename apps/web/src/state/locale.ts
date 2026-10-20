/** UI language (SPEC Sec 10): preference saved in settings; RTL via <html dir>. */
import { create } from 'zustand';
import { getDirection, resolveLocale, setLocale } from '@dasignature/i18n';
import type { DataStore } from '@dasignature/storage';

interface LocaleState {
  pref: string;
  locale: string;
  setPref: (pref: string) => void;
}

const KEY = 'locale';
let persistTo: DataStore | undefined;

function apply(pref: string): string {
  const locale = setLocale(resolveLocale(pref, navigator.languages));
  document.documentElement.lang = locale;
  document.documentElement.dir = getDirection(locale);
  return locale;
}

export const useLocale = create<LocaleState>()((set) => ({
  pref: 'system',
  locale: 'en',
  setPref: (pref) => {
    set({ pref, locale: apply(pref) });
    void persistTo?.setSetting(KEY, pref).catch(() => undefined);
  },
}));

export async function loadLocale(store: DataStore): Promise<void> {
  persistTo = store;
  const pref = (await store.getSetting(KEY).catch(() => undefined)) ?? 'system';
  useLocale.setState({ pref, locale: apply(pref) });
}
