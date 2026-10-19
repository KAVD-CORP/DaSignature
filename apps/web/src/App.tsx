import { useEffect } from 'react';
import { APP_NAME, APP_VERSION } from '@dasignature/core';
import { DEFAULT_LOCALE, getDirection } from '@dasignature/i18n';
import { applyTheme, THEME_PREFERENCES, type ThemePreference } from '@dasignature/ui';
import { useThemeStore } from './state/theme.ts';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function App() {
  const theme = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.setPreference);

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = DEFAULT_LOCALE;
    document.documentElement.dir = getDirection(DEFAULT_LOCALE);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
      <img src="/favicon.svg" alt="" width={96} height={96} data-decorative />
      <h1 className="text-headline font-semibold tracking-wordmark">
        <span className="font-normal">Da</span>Signature
      </h1>
      <p className="text-body-sm text-text-muted">Your files never leave your device.</p>

      <fieldset className="rounded-card border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-muted">Appearance</legend>
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {THEME_PREFERENCES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              data-ui-state="radio"
              aria-checked={theme === option}
              onClick={() => {
                setTheme(option);
              }}
              className={
                'min-h-target min-w-target rounded-pill px-4 text-body-sm font-medium transition-colors duration-fast ease-out ' +
                (theme === option
                  ? 'bg-primary text-on-primary'
                  : 'border border-border-strong bg-surface-2 text-text')
              }
            >
              {THEME_LABELS[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <footer className="text-caption text-text-muted">
        {APP_NAME} {APP_VERSION} · Stored on this device only
      </footer>
    </main>
  );
}
