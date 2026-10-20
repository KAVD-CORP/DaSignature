import { lazy, Suspense, useEffect } from 'react';
import { DEFAULT_LOCALE, getDirection, t } from '@dasignature/i18n';
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

// Lazy chunk (SPEC Sec 5 rule 6): pdf.js and the editor load only when a document opens.
const Editor = lazy(() => import('./screens/Editor.tsx'));

let booting: Promise<void> | undefined;
export function boot(factory: ServiceFactory = createServices): Promise<void> {
  booting ??= (async () => {
    try {
      const services = await factory();
      useApp.getState().set({ services, status: 'ready' });
      await loadTheme(services.store);
      await useApp.getState().refreshDocs();
    } catch (err) {
      console.error(err);
      useApp.getState().set({ status: 'error' });
    }
  })();
  return booting;
}
/** Tests only. */
export function resetBoot(): void {
  booting = undefined;
}

export function App({ factory }: { factory?: ServiceFactory }) {
  const theme = useThemeStore((s) => s.preference);
  const status = useApp((s) => s.status);
  const route = useRoute();

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = DEFAULT_LOCALE;
    document.documentElement.dir = getDirection(DEFAULT_LOCALE);
    void boot(factory);
  }, [factory]);

  if (status === 'booting')
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label={t('app.loading')} />
      </main>
    );
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
    <>
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
    </>
  );
}
