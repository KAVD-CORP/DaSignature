/** Settings (design 07): grouped list; sub-pages open in place with a back link. */
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Database,
  Download,
  FileCheck,
  Globe,
  Info,
  KeyRound,
  Lock,
  Palette,
  Scale,
  Shield,
  Timer,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_VERSION, DATE_FORMATS, formatDate, todayIso } from '@dasignature/core';
import { LOCALES, currentLocale, matchesConfirmWord, t } from '@dasignature/i18n';
import { THEME_PREFERENCES, type ThemePreference } from '@dasignature/ui';
import {
  AUTO_LOCK_OPTIONS,
  createBackup,
  isUpdateRequired,
  readManifest,
  restoreBackup,
  type AutoLockMinutes,
  type DasigManifest,
  type PlainDump,
} from '@dasignature/storage';
import privacyText from '../../../../docs/privacy.md?raw';
import noticesText from '../../../../THIRD_PARTY_NOTICES.md?raw';
import { Button, Modal } from '../components/ui.tsx';
import { Switch } from '../components/controls.tsx';
import { IntegrityCheck } from '../components/IntegrityCheck.tsx';
import { pickFiles } from '../services/files.ts';
import { useApp } from '../state/app.ts';
import { useLocale } from '../state/locale.ts';
import { AUTOLOCK_KEY, lockNow, parseAutoLock, setAutoLock } from '../state/lock.ts';
import { useThemeStore } from '../state/theme.ts';

type Page = 'root' | 'signer' | 'date' | 'language' | 'backup' | 'privacy' | 'licenses' | 'about';

const THEME_KEY: Record<
  ThemePreference,
  'settings.themeSystem' | 'settings.themeLight' | 'settings.themeDark'
> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
};

function useSetting(key: string): [string | undefined, (v: string) => void] {
  const store = useApp((s) => s.services?.store);
  const showToast = useApp((s) => s.showToast);
  const [value, setValue] = useState<string | undefined>();
  useEffect(() => {
    if (!store) return;
    let on = true;
    void store.getSetting(key).then((v) => {
      if (on) setValue(v ?? '');
    });
    return () => {
      on = false;
    };
  }, [store, key]);
  return [
    value,
    (v) => {
      setValue(v);
      void store?.setSetting(key, v).catch(() => {
        showToast({ text: t('settings.saveFailed'), tone: 'error' });
      });
    },
  ];
}

function Group({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="mb-6 flex break-inside-avoid flex-col gap-2">
      <h2
        id={id}
        className="px-1 text-caption font-semibold uppercase tracking-[0.04em] text-text-muted"
      >
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon,
  label,
  help,
  value,
  onClick,
  children,
}: {
  icon: ReactNode;
  label: string;
  help?: string;
  value?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span aria-hidden className="shrink-0 text-text">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="text-body-sm font-medium text-text">{label}</span>
        {help ? <span className="text-caption text-text-muted">{help}</span> : null}
      </span>
      {value !== undefined ? <span className="text-body-sm text-text">{value}</span> : null}
      {children}
      {onClick ? (
        <ChevronRight aria-hidden size={18} className="shrink-0 text-text rtl:rotate-180" />
      ) : null}
    </>
  );
  return onClick ? (
    <button
      type="button"
      data-settings-row={label}
      onClick={onClick}
      className="flex min-h-target w-full items-center gap-3 px-3 py-2 hover:bg-surface-2"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-h-target items-center gap-3 px-3 py-2">{body}</div>
  );
}

const ic = (C: typeof Lock) => <C size={20} strokeWidth={1.75} />;

function SubPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 tablet:p-6 desktop:p-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-target items-center gap-2 self-start rounded-input px-2 text-body-sm text-text hover:bg-surface-2"
      >
        <ArrowLeft aria-hidden size={18} className="rtl:rotate-180" />
        {t('settings.back')}
      </button>
      <h1 ref={h} tabIndex={-1} className="text-headline font-semibold outline-none">
        {title}
      </h1>
      {children}
    </main>
  );
}

const inputCls =
  'min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text';

function autoLockLabel(m: AutoLockMinutes): string {
  if (m === null) return t('settings.autoLockNever');
  if (m === 0) return t('settings.autoLockImmediately');
  if (m === 1) return t('settings.autoLockMinute');
  return t('settings.autoLockMinutes', { count: String(m) });
}

function dateLabel(f: string): string {
  const today = todayIso();
  if (f === 'locale-short')
    return t('settings.dateFollowRegion', { example: formatDate(today, f, currentLocale()) });
  return formatDate(today, f, currentLocale());
}

/** Passcode set/confirm or verify sheet. */
function PasscodeDialog({
  mode,
  onDone,
  onClose,
}: {
  mode: 'set' | 'verify';
  onDone: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const [first, setFirst] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const title =
    mode === 'verify'
      ? t('settings.currentPasscode')
      : first === undefined
        ? t('settings.setPasscode')
        : t('settings.confirmPasscode');
  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'set' && first === undefined) {
            setFirst(code);
            setCode('');
            return;
          }
          if (mode === 'set' && first !== code) {
            setError(t('settings.passcodeMismatch'));
            setFirst(undefined);
            setCode('');
            return;
          }
          void onDone(code).catch(() => {
            setError(t('settings.wrongPasscode'));
            setCode('');
          });
        }}
      >
        <input
          key={first === undefined ? 'a' : 'b'}
          type="password"
          inputMode="numeric"
          autoComplete={mode === 'set' ? 'new-password' : 'current-password'}
          autoFocus
          aria-label={t('settings.passcode')}
          maxLength={6}
          pattern="[0-9]{6}"
          data-ui-state="input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
            setError(undefined);
          }}
          className={`${inputCls} text-center tracking-[0.3em]`}
        />
        {error ? (
          <p role="alert" className="text-body-sm text-text">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('app.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={code.length !== 6}>
            {t('app.ok')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClearDataDialog({ onClose }: { onClose: () => void }) {
  const services = useApp((s) => s.services);
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const word = t('settings.clearData.confirmWord');
  const ok = matchesConfirmWord(typed, currentLocale());
  const lockOn = useLockMode() === 'passcode';
  const run = async (passcode?: string) => {
    if (!services) return;
    if (passcode && services.lock) await services.lock.clearPasscode(passcode); // throws if wrong
    setBusy(true);
    const empty: PlainDump = {
      schemaVersion: 0,
      tables: {
        documents: [],
        signatures: [],
        placements: [],
        exports: [],
        pen_presets: [],
        templates: [],
        settings: [],
      },
      files: new Map(),
    };
    await services.store.replaceAll(empty, { confirmReplaceAll: true });
    sessionStorage.setItem('dasig.cleared', '1');
    location.hash = '#/';
    location.reload();
  };
  return (
    <Modal open onClose={onClose} title={t('settings.clearData.title')} dismissable={!busy}>
      {reauth ? (
        <PasscodeDialog
          mode="verify"
          onClose={() => {
            setReauth(false);
          }}
          onDone={run}
        />
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!ok) return;
          if (lockOn) setReauth(true);
          else void run();
        }}
      >
        <p className="text-body-sm text-text">{t('settings.clearData.body')}</p>
        <label className="flex flex-col gap-1 text-body-sm text-text">
          <span>
            {t('settings.clearData.confirmLabel', { confirmWord: '\u0000' }).split('\u0000')[0]}
            <span className="font-mono font-semibold">{word}</span>
            {t('settings.clearData.confirmLabel', { confirmWord: '\u0000' }).split('\u0000')[1]}
          </span>
          <input
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoCapitalize="characters"
            aria-describedby="clear-help"
            data-ui-state="input"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            onBlur={() => {
              setTouched(true);
            }}
            className={inputCls}
          />
          <span id="clear-help" className="text-caption text-text-muted">
            {touched && typed && !ok
              ? t('settings.clearData.mismatch', { confirmWord: word })
              : t('settings.clearData.confirmHelp')}
          </span>
        </label>
        {busy ? <p aria-live="polite">{t('settings.clearData.progress')}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t('settings.clearData.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={!ok || busy}>
            {t('settings.clearData.confirmButton')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type LockMode = 'none' | 'new' | 'device' | 'passcode';
function useLockMode(): LockMode | undefined {
  const services = useApp((s) => s.services);
  const [mode, setMode] = useState<LockMode | undefined>();
  const tick = useApp((s) => s.lockTick);
  useEffect(() => {
    const lock = services?.lock;
    if (!lock) {
      setTimeout(() => {
        setMode('none');
      }, 0);
      return;
    }
    void lock.mode().then(setMode);
  }, [services, tick]);
  return mode;
}

function BackupPage() {
  const services = useApp((s) => s.services);
  const showToast = useApp((s) => s.showToast);
  const refreshDocs = useApp((s) => s.refreshDocs);
  const [last, setLast] = useSetting('backup.last');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<
    { file: Uint8Array; manifest: DasigManifest } | undefined
  >();
  const [rpw, setRpw] = useState('');
  const [rError, setRError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const pwError =
    pw && pw.length < 8
      ? t('settings.backupPasswordShort')
      : pw2 && pw !== pw2
        ? t('settings.backupPasswordMismatch')
        : undefined;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-sm text-text">
        {t('settings.lastBackup', {
          date: last ? new Date(last).toLocaleDateString(currentLocale()) : t('settings.never'),
        })}
      </p>
      <form
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!services || pwError || pw.length < 8 || pw !== pw2) return;
          setBusy(true);
          void (async () => {
            try {
              const bytes = await createBackup(services.store, pw, { appVersion: APP_VERSION });
              const name = `DaSignature-backup-${todayIso()}.dasig`;
              const saved = await services.files.saveFile(name, bytes, 'application/octet-stream');
              if (saved) {
                setLast(new Date().toISOString());
                showToast({ text: t('settings.backupSaved') });
                setPw('');
                setPw2('');
              }
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <h2 className="text-body font-semibold">{t('settings.createBackup')}</h2>
        <label className="flex flex-col gap-1 text-body-sm">
          {t('settings.backupPassword')}
          <input
            type="password"
            autoComplete="new-password"
            data-ui-state="input"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
            }}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          {t('settings.backupPasswordConfirm')}
          <input
            type="password"
            autoComplete="new-password"
            data-ui-state="input"
            value={pw2}
            onChange={(e) => {
              setPw2(e.target.value);
            }}
            className={inputCls}
          />
        </label>
        {pwError ? <p className="text-body-sm text-text">{pwError}</p> : null}
        <p className="text-caption text-text-muted">{t('settings.backupNote')}</p>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={busy || pw.length < 8 || pw !== pw2}
          className="self-start"
        >
          <Download aria-hidden size={18} />
          {t('settings.createBackup')}
        </Button>
      </form>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <h2 className="text-body font-semibold">{t('settings.restore')}</h2>
        {!restore ? (
          <Button
            className="self-start"
            onClick={() => {
              void (async () => {
                const [f] = await pickFiles('.dasig,application/octet-stream');
                if (!f) return;
                const file = new Uint8Array(await f.arrayBuffer());
                try {
                  setRestore({ file, manifest: readManifest(file).manifest });
                  setRError(undefined);
                } catch (err) {
                  setRError(
                    isUpdateRequired(err) ? t('settings.newerBackup') : t('settings.notBackup'),
                  );
                }
              })();
            }}
          >
            {t('settings.restore')}
          </Button>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <p className="text-body-sm text-text" data-restore-preview>
              {t('settings.restoreFrom', {
                date: new Date(restore.manifest.createdAt).toLocaleString(currentLocale()),
                version: restore.manifest.appVersion,
              })}
            </p>
            <label className="flex flex-col gap-1 text-body-sm">
              {t('settings.restorePassword')}
              <input
                type="password"
                autoComplete="off"
                data-ui-state="input"
                value={rpw}
                onChange={(e) => {
                  setRpw(e.target.value);
                  setRError(undefined);
                }}
                className={inputCls}
              />
            </label>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setRestore(undefined);
                  setRpw('');
                }}
              >
                {t('app.cancel')}
              </Button>
              <Button type="submit" variant="danger" disabled={!rpw || busy} busy={busy}>
                {t('settings.restoreReplace')}
              </Button>
            </div>
          </form>
        )}
        {rError ? (
          <p role="alert" className="text-body-sm text-text">
            {rError}
          </p>
        ) : null}
      </div>
      <Modal
        open={confirm}
        onClose={() => {
          setConfirm(false);
        }}
        title={t('settings.restoreReplaceTitle')}
      >
        <p className="text-body-sm text-text">{t('settings.restoreReplaceBody')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={() => {
              setConfirm(false);
            }}
          >
            {t('app.cancel')}
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() => {
              if (!services || !restore) return;
              setBusy(true);
              void restoreBackup(services.store, restore.file, rpw, { confirmReplaceAll: true })
                .then(async () => {
                  setConfirm(false);
                  setRestore(undefined);
                  setRpw('');
                  await refreshDocs();
                  showToast({ text: t('settings.restored') });
                })
                .catch((err: unknown) => {
                  setConfirm(false);
                  const name = err instanceof Error ? err.name : '';
                  setRError(
                    isUpdateRequired(err)
                      ? t('settings.newerBackup')
                      : name === 'BackupPasswordError' || name === 'WrongPasswordError'
                        ? t('settings.wrongPassword')
                        : t('settings.notBackup'),
                  );
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {t('settings.restoreReplace')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StorageRow() {
  const services = useApp((s) => s.services);
  const docs = useApp((s) => s.docs);
  const [text, setText] = useState<string | undefined>();
  const [quota, setQuota] = useState<string | undefined>();
  useEffect(() => {
    if (!services) return;
    const st = { on: true };
    const alive = () => st.on;
    void (async () => {
      const sigs = await services.store.listSignatures();
      let exports = 0;
      for (const d of docs) exports += (await services.store.listExports(d.id)).length;
      const sm = navigator.storage as StorageManager | undefined;
      const est = await sm?.estimate().catch(() => undefined);
      if (!alive()) return;
      setText(
        t('settings.storageSummary', {
          documents: String(docs.length),
          signatures: String(sigs.length),
          exports: String(exports),
        }),
      );
      const mb = (n?: number) => `${((n ?? 0) / 1048576).toFixed(1)} MB`;
      if (est && services.kind === 'web')
        setQuota(t('settings.storageQuota', { used: mb(est.usage), quota: mb(est.quota) }));
    })();
    return () => {
      st.on = false;
    };
  }, [services, docs]);
  return (
    <Row
      icon={ic(Database)}
      label={t('settings.storage')}
      help={[
        text ?? t('settings.calculating'),
        quota,
        services?.kind === 'web' ? t('settings.storageWebNote') : undefined,
      ]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

export function Settings() {
  const theme = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.setPreference);
  const localePref = useLocale((s) => s.pref);
  const setLocalePref = useLocale((s) => s.setPref);
  const services = useApp((s) => s.services);
  const bumpLock = useApp((s) => s.bumpLock);
  const [page, setPage] = useState<Page>('root');
  const [signer, setSigner] = useSetting('signer_name');
  const [dateFmt, setDateFmt] = useSetting('date_format');
  const [autolock, setAutolockRaw] = useSetting(AUTOLOCK_KEY);
  const lockMode = useLockMode();
  const [passcode, setPasscode] = useState<'set' | 'verify' | undefined>();
  const [clear, setClear] = useState(false);
  const back = () => {
    setPage('root');
  };
  const systemName =
    LOCALES.find((l) => l.id === (navigator.language.split('-')[0] ?? 'en'))?.name ?? 'English';

  if (page === 'signer')
    return (
      <SubPage title={t('settings.signerName')} onBack={back}>
        <label className="flex flex-col gap-1 text-body-sm">
          {t('settings.signerName')}
          <input
            autoComplete="name"
            data-ui-state="input"
            value={signer ?? ''}
            onChange={(e) => {
              setSigner(e.target.value);
            }}
            className={inputCls}
          />
          <span className="text-caption text-text-muted">{t('settings.signerHelp')}</span>
        </label>
      </SubPage>
    );
  if (page === 'date' || page === 'language') {
    const opts =
      page === 'date'
        ? DATE_FORMATS.filter((f) => f !== 'locale-medium').map((f) => ({
            id: f,
            label: dateLabel(f),
          }))
        : [
            { id: 'system', label: t('settings.languageSystem', { name: systemName }) },
            ...LOCALES.map((l) => ({ id: l.id, label: l.name })),
          ];
    const value = page === 'date' ? dateFmt || 'locale-short' : localePref;
    return (
      <SubPage
        title={page === 'date' ? t('settings.dateFormat') : t('settings.language')}
        onBack={back}
      >
        {page === 'date' ? (
          <p className="text-body-sm text-text">{t('settings.dateFormatHelp')}</p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={page === 'date' ? t('settings.dateFormat') : t('settings.language')}
          className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface"
        >
          {opts.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              data-ui-state="radio"
              aria-checked={value === o.id}
              lang={page === 'language' && o.id !== 'system' ? o.id : undefined}
              onClick={() => {
                if (page === 'date') setDateFmt(o.id);
                else setLocalePref(o.id);
              }}
              className="flex min-h-target items-center justify-between px-3 text-start text-body-sm text-text hover:bg-surface-2"
            >
              {o.label}
              <span
                aria-hidden
                className={`h-4 w-4 rounded-full border-2 ${value === o.id ? 'border-primary bg-primary' : 'border-border-strong'}`}
              />
            </button>
          ))}
        </div>
      </SubPage>
    );
  }
  if (page === 'backup')
    return (
      <SubPage title={t('settings.backup')} onBack={back}>
        <BackupPage />
      </SubPage>
    );
  if (page === 'privacy' || page === 'licenses')
    return (
      <SubPage
        title={page === 'privacy' ? t('settings.privacy') : t('settings.licenses')}
        onBack={back}
      >
        <pre className="whitespace-pre-wrap rounded-card border border-border bg-surface p-4 font-sans text-body-sm text-text">
          {page === 'privacy' ? privacyText : noticesText}
        </pre>
      </SubPage>
    );
  if (page === 'about')
    return (
      <SubPage title={t('settings.aboutApp')} onBack={back}>
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 text-body-sm text-text">
          <p className="text-title font-semibold">DaSignature</p>
          <p>{t('settings.version', { version: APP_VERSION })}</p>
          <p>{t('settings.license')}</p>
          <p>{t('settings.legalNote')}</p>
          <Button
            className="self-start"
            onClick={() => {
              void services?.store.setSetting('onboarding.done', '').then(() => {
                useApp.getState().set({ intro: true });
              });
            }}
          >
            {t('settings.showIntro')}
          </Button>
        </div>
      </SubPage>
    );

  const al = parseAutoLock(autolock || undefined);
  return (
    <main className="mx-auto flex max-w-[720px] flex-col p-4 tablet:p-6 desktop:max-w-[1200px] desktop:p-8">
      <h1 className="mb-6 text-headline font-semibold">{t('settings.title')}</h1>
      <div className="desktop:columns-2 desktop:gap-6">
        <Group title={t('settings.appearance')} id="g-appearance">
          <Row icon={ic(Palette)} label={t('settings.theme')}>
            <div role="radiogroup" aria-label={t('settings.theme')} className="flex gap-1">
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
                  className={`min-h-target rounded-pill px-3 text-body-sm font-medium ${theme === option ? 'bg-primary text-on-primary' : 'border border-border-strong bg-surface-2 text-text'}`}
                >
                  {t(THEME_KEY[option])}
                </button>
              ))}
            </div>
          </Row>
          <Row
            icon={ic(Globe)}
            label={t('settings.language')}
            value={
              localePref === 'system'
                ? t('settings.languageSystem', { name: systemName })
                : (LOCALES.find((l) => l.id === localePref)?.name ?? '')
            }
            onClick={() => {
              setPage('language');
            }}
          />
        </Group>
        <Group title={t('settings.signing')} id="g-signing">
          <Row
            icon={ic(UserRound)}
            label={t('settings.signerName')}
            value={signer ?? ''}
            onClick={() => {
              setPage('signer');
            }}
          />
          <Row
            icon={ic(CalendarDays)}
            label={t('settings.dateFormat')}
            value={dateLabel(dateFmt || 'locale-short')}
            onClick={() => {
              setPage('date');
            }}
          />
        </Group>
        <Group title={t('settings.security')} id="g-security">
          {services?.lock ? (
            <div className="px-3 py-1">
              <Switch
                label={t('settings.appLock')}
                description={t('settings.appLockWebHelp')}
                checked={lockMode === 'passcode'}
                onChange={(on) => {
                  setPasscode(on ? 'set' : 'verify');
                }}
              />
            </div>
          ) : (
            <Row
              icon={ic(Shield)}
              label={t('settings.appLock')}
              help={t('settings.appLockNativeHelp')}
            />
          )}
          <Row icon={ic(Timer)} label={t('settings.autoLock')}>
            <select
              aria-label={t('settings.autoLock')}
              data-ui-state="input"
              disabled={lockMode !== 'passcode'}
              value={al === null ? 'never' : String(al)}
              onChange={(e) => {
                setAutolockRaw(e.target.value);
                setAutoLock(parseAutoLock(e.target.value));
              }}
              className={inputCls}
            >
              {AUTO_LOCK_OPTIONS.map((m) => (
                <option key={String(m)} value={m === null ? 'never' : String(m)}>
                  {autoLockLabel(m)}
                </option>
              ))}
            </select>
          </Row>
          {lockMode === 'passcode' ? (
            <Row icon={ic(Lock)} label={t('lock.lockNow')} onClick={lockNow} />
          ) : null}
        </Group>
        <Group title={t('settings.data')} id="g-data">
          <Row
            icon={ic(KeyRound)}
            label={t('settings.backup')}
            help={t('settings.backupHelp')}
            onClick={() => {
              setPage('backup');
            }}
          />
          <StorageRow />
        </Group>
        <Group title={t('integrity.title')} id="g-integrity">
          <div className="p-1">
            <IntegrityCheck />
          </div>
        </Group>
        <Group title={t('settings.about')} id="g-about">
          <Row
            icon={ic(FileCheck)}
            label={t('settings.privacy')}
            onClick={() => {
              setPage('privacy');
            }}
          />
          <Row
            icon={ic(Scale)}
            label={t('settings.licenses')}
            onClick={() => {
              setPage('licenses');
            }}
          />
          <Row
            icon={ic(Info)}
            label={t('settings.aboutApp')}
            value={APP_VERSION}
            onClick={() => {
              setPage('about');
            }}
          />
        </Group>
        <Group title={t('settings.clearData.row')} id="g-clear">
          <div className="flex flex-col gap-2 p-3">
            <p className="text-caption text-text-muted">{t('settings.clearData.rowHelp')}</p>
            <Button
              variant="danger"
              className="self-start"
              onClick={() => {
                setClear(true);
              }}
            >
              <Trash2 aria-hidden size={18} />
              {t('settings.clearData.row')}
            </Button>
          </div>
        </Group>
      </div>
      {passcode && services?.lock ? (
        <PasscodeDialog
          mode={passcode}
          onClose={() => {
            setPasscode(undefined);
          }}
          onDone={async (code) => {
            const lock = services.lock;
            if (!lock) return;
            if (passcode === 'set') {
              await lock.setPasscode(code);
              await lock.unlock(code);
            } else await lock.clearPasscode(code);
            setPasscode(undefined);
            bumpLock();
          }}
        />
      ) : null}
      {clear ? (
        <ClearDataDialog
          onClose={() => {
            setClear(false);
          }}
        />
      ) : null}
    </main>
  );
}
