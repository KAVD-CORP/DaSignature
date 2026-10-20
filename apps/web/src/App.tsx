import { lazy, Suspense, useEffect, useState } from 'react';
import { t } from '@dasignature/i18n';
import { applyTheme } from '@dasignature/ui';
import { GlobalDialogs } from './components/GlobalDialogs.tsx';
import { Shell } from './components/Shell.tsx';
import { Button, Spinner, ToastHost } from './components/ui.tsx';
import { Library } from './screens/Library.tsx';
import { Settings } from './screens/Settings.tsx';
import { Signatures } from './screens/Signatures.tsx';
import { createServices, type ServiceFactory } from './services/platform.ts';
import { useApp } from './state/app.ts';
import { useRoute } from './state/route.ts';
import { loadTheme, useThemeStore } from './state/theme.ts';
import { loadLocale, useLocale } from './state/locale.ts';
import { AUTOLOCK_KEY, installAutoLock, parseAutoLock, setAutoLock } from './state/lock.ts';

// Lazy chunk (SPEC Sec 5 rule 6): pdf.js and the editor load only when a document opens.
const Editor = lazy(() => import('./screens/Editor.tsx'));

let booting: Promise<void> | undefined;
export function boot(factory: ServiceFactory = createServices): Promise<void> {
  booting ??= (async () => {
    try {
      const services = await factory();
      await loadTheme(services.store);
      await loadLocale(services.store);
      setAutoLock(
        parseAutoLock(await services.store.getSetting(AUTOLOCK_KEY).catch(() => undefined)),
      );
      if (services.lock && !services.lock.isUnlocked()) {
        useApp.getState().set({ services, status: 'locked' });
        return;
      }
      useApp.getState().set({ services, status: 'ready' });
      await useApp.getState().refreshDocs();
      if (sessionStorage.getItem('dasig.cleared')) {
        sessionStorage.removeItem('dasig.cleared');
        useApp.getState().showToast({ text: t('settings.clearData.done') });
      }
    } catch (err) {
      console.error(err);
      useApp.getState().set({ status: 'error' });
    }
  })();
  return booting;
}
/** After the passcode: unlock and continue. Throws WrongPasswordError. */
export async function unlockApp(passcode: string): Promise<void> {
  const { services } = useApp.getState();
  if (!services?.lock) return;
  await services.lock.unlock(passcode);
  useApp.getState().set({ status: 'ready' });
  await useApp.getState().refreshDocs();
}

function LockScreen() {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <h1 className="text-title font-semibold">{t('lock.title')}</h1>
      <p className="text-body-sm text-text">{t('lock.body')}</p>
      <form
        className="flex flex-col items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void unlockApp(code)
            .catch(() => {
              setError(true);
              setCode('');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          aria-label={t('settings.passcode')}
          aria-invalid={error || undefined}
          aria-describedby={error ? 'lock-error' : undefined}
          data-ui-state="input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(false);
          }}
          className="min-h-target w-48 rounded-input border border-border-strong bg-surface px-3 text-center text-title tracking-[0.3em] text-text"
        />
        {error ? (
          <p id="lock-error" role="alert" className="text-body-sm text-text">
            {t('settings.wrongPasscode')}
          </p>
        ) : null}
        <Button type="submit" variant="primary" busy={busy} disabled={code.length < 4}>
          {t('lock.unlock')}
        </Button>
      </form>
    </main>
  );
}

/** Tests only. */
export function resetBoot(): void {
  booting = undefined;
}

export function App({ factory }: { factory?: ServiceFactory }) {
  const theme = useThemeStore((s) => s.preference);
  const status = useApp((s) => s.status);
  const route = useRoute();
  const locale = useLocale((s) => s.locale);

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  useEffect(() => {
    void boot(factory);
  }, [factory]);
  useEffect(() => installAutoLock(), []);

  if (status === 'booting')
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label={t('app.loading')} />
      </main>
    );
  if (status === 'locked') return <LockScreen key={locale} />;
  if (status === 'error')
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="text-title font-semibold">{t('app.bootError')}</h1>
        <Button
          variant="primary"
          onClick={() => {
            location.reload();
          }}
        >
          {t('app.retry')}
        </Button>
      </main>
    );

  return (
    <div key={locale} className="contents">
      {route.name === 'doc' ? (
        <Suspense
          fallback={
            <main className="flex min-h-dvh items-center justify-center bg-canvas">
              <Spinner label={t('app.loading')} />
            </main>
          }
        >
          <Editor docId={route.id} />
        </Suspense>
      ) : (
        <Shell route={route}>
          {route.name === 'settings' ? (
            <Settings />
          ) : route.name === 'signatures' ? (
            <Signatures />
          ) : (
            <Library />
          )}
        </Shell>
      )}
      <GlobalDialogs />
      <ToastHost />
    </div>
  );
}
