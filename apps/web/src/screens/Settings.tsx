import { t } from '@dasignature/i18n';
import { THEME_PREFERENCES, type ThemePreference } from '@dasignature/ui';
import { useThemeStore } from '../state/theme.ts';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function Settings() {
  const theme = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.setPreference);
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-6 p-4 tablet:p-6 desktop:p-8">
      <h1 className="text-headline font-semibold">{t('nav.settings')}</h1>
      <section aria-labelledby="appearance" className="flex flex-col gap-2">
        <h2
          id="appearance"
          className="text-caption font-semibold uppercase tracking-[0.04em] text-text-muted"
        >
          Appearance
        </h2>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex gap-2 rounded-card border border-border bg-surface p-3"
        >
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
              className={`min-h-target min-w-target rounded-pill px-4 text-body-sm font-medium transition-colors duration-fast ease-out ${theme === option ? 'bg-primary text-on-primary' : 'border border-border-strong bg-surface-2 text-text'}`}
            >
              {THEME_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
