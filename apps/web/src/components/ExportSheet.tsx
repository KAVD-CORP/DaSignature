/** Export sheet (design 06): name, audit page, flatten, encryption notice, Save/Share, success. */
import { CircleCheck, Copy, FileText, Info, LockKeyhole, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { signedFileName } from '@dasignature/pdf';
import type { Protection } from '@dasignature/pdf/render';
import { t } from '@dasignature/i18n';
import type { DocumentRecord, SignatureRecord } from '@dasignature/storage';
import { Button, Modal } from './ui.tsx';
import { Switch } from './controls.tsx';
import { useApp } from '../state/app.ts';
import { navigate } from '../state/route.ts';
import type { Placed } from '../state/placements.ts';
import { ExportFailure, buildItems, runExport, type ExportJob } from '../services/exporter.ts';

const BAD_CHARS = /[/\\:*?"<>|]/;

export function protectionCase(p: Protection): 0 | 1 | 2 | 3 | 4 {
  if (p.openPassword) return p.restricted ? 2 : 1;
  if (p.restricted) return 3;
  return p.encrypted ? 4 : 0;
}

function ProtectionNotice({ c }: { c: 1 | 2 | 3 | 4 }) {
  const title =
    c <= 2
      ? t('export.protectionNotice.passwordTitle')
      : c === 3
        ? t('export.protectionNotice.restrictionsTitle')
        : t('export.protectionNotice.encryptedTitle');
  const body =
    c === 1
      ? t('export.protectionNotice.passwordBody')
      : c === 2
        ? `${t('export.protectionNotice.passwordBody')} ${t('export.protectionNotice.restrictionsRemoved')}`
        : c === 3
          ? t('export.protectionNotice.restrictionsBody')
          : t('export.protectionNotice.encryptedBody');
  return (
    <div
      role="note"
      data-protection-case={c}
      className="flex gap-3 rounded-card border border-border bg-surface-2 p-3 text-text"
    >
      <LockKeyhole aria-hidden size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-body font-semibold">{title}</p>
        <p className="text-body-sm">{body}</p>
      </div>
    </div>
  );
}

function protectionLine(c: 0 | 1 | 2 | 3 | 4): string | undefined {
  const k = 'export.success.protection.';
  if (c === 1) return t(`${k}noPassword` as 'export.success.protection.noPassword');
  if (c === 2)
    return `${t('export.success.protection.noPassword')} · ${t('export.success.protection.noRestrictions')}`;
  if (c === 3) return t('export.success.protection.noRestrictions');
  if (c === 4) return t('export.success.protection.notEncrypted');
  return undefined;
}

const fmtSize = (n: number) =>
  n < 1024 * 1024
    ? `${String(Math.max(1, Math.round(n / 1024)))} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

type Phase =
  | { kind: 'form' }
  | { kind: 'busy'; stage: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'done'; name: string; bytes: Uint8Array; sha256: string };

export function ExportSheet({
  open,
  onClose,
  rec,
  original,
  password,
  protection,
  hasForm,
  items,
  sigs,
}: {
  open: boolean;
  onClose: () => void;
  rec: DocumentRecord;
  original: Uint8Array;
  password: string | undefined;
  protection: Protection;
  hasForm: boolean;
  items: readonly Placed[];
  sigs: ReadonlyMap<string, SignatureRecord>;
}) {
  const services = useApp((s) => s.services);
  const showToast = useApp((s) => s.showToast);
  const refreshDocs = useApp((s) => s.refreshDocs);
  const [name, setName] = useState<string | undefined>();
  const [defaultName, setDefaultName] = useState(() => signedFileName(`${rec.title}.pdf`));
  const [audit, setAudit] = useState(false);
  const [flatten, setFlatten] = useState(true);
  const [signer, setSigner] = useState<string | undefined>();
  const [savedSigner, setSavedSigner] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const job = useRef<ExportJob | undefined>(undefined);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pc = protectionCase(protection);
  const phone = useMemo(() => innerWidth < 600, []);

  useEffect(() => {
    if (!services) return;
    const st = { on: true };
    const alive = () => st.on;
    void (async () => {
      const exps = await services.store.listExports(rec.id);
      // Rebuild this document's export names in order (PM #39/#48/#50 counter).
      const names: string[] = [];
      for (let i = 0; i < exps.length; i++) names.push(signedFileName(`${rec.title}.pdf`, names));
      const s = (await services.store.getSetting('signer_name')) ?? '';
      if (!alive()) return;
      setDefaultName(signedFileName(`${rec.title}.pdf`, names));
      setSavedSigner(s);
    })();
    return () => {
      st.on = false;
    };
  }, [services, rec]);

  useEffect(
    () => () => {
      job.current?.cancel();
    },
    [],
  );

  const stem = (name ?? defaultName).replace(/\.pdf$/i, '');
  const nameError = !stem.trim()
    ? t('export.fileNameEmpty')
    : BAD_CHARS.test(stem)
      ? t('export.fileNameBad')
      : undefined;
  const signerName = signer ?? savedSigner;

  const start = async (via: 'save' | 'share') => {
    if (!services || nameError) return;
    const fileName = `${stem.trim()}.pdf`;
    setPhase({ kind: 'busy', stage: t('export.stageSignatures') });
    try {
      const built = await buildItems(items, sigs, services.store);
      const j = runExport(
        {
          original,
          expectedSha256: rec.sha256,
          password,
          items: built,
          flattenForms: hasForm && flatten,
          auditPage: audit,
          signer: signerName.trim(),
          platform: services.kind,
        },
        (stage) => {
          setPhase({
            kind: 'busy',
            stage:
              stage === 'flatten'
                ? t('export.stageFlatten')
                : stage === 'write'
                  ? t('export.stageWrite')
                  : t('export.stageSignatures'),
          });
        },
      );
      job.current = j;
      const out = await j.promise;
      job.current = undefined;
      if (audit && signer !== undefined && signer.trim() && !savedSigner)
        await services.store.setSetting('signer_name', signer.trim());
      await services.store.addExport({
        documentId: rec.id,
        pdf: out.bytes,
        signerName: signerName.trim() || undefined,
      });
      await services.store.setDocumentStatus(rec.id, 'signed');
      void refreshDocs();
      if (via === 'share' && services.share && (await services.share.canShare())) {
        await services.share.shareFile(fileName, out.bytes, 'application/pdf');
      } else {
        const saved = await services.files.saveFile(fileName, out.bytes, 'application/pdf');
        if (!saved) {
          setPhase({ kind: 'form' }); // cancelled the save dialog: back to the sheet, silently
          return;
        }
      }
      setPhase({ kind: 'done', name: fileName, bytes: out.bytes, sha256: out.sha256 });
      requestAnimationFrame(() => titleRef.current?.focus());
    } catch (err) {
      job.current = undefined;
      if (err instanceof ExportFailure && err.code === 'cancelled') {
        setPhase({ kind: 'form' });
        return;
      }
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
      setPhase({
        kind: 'error',
        code: quota ? 'storage' : err instanceof ExportFailure ? err.code : 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const busy = phase.kind === 'busy';

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={phase.kind === 'done' ? t('export.successTitle') : t('export.title')}
      dismissable={!busy}
    >
      {phase.kind === 'done' ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            className="flex h-[72px] w-[72px] items-center justify-center rounded-pill bg-success-chip-bg"
            style={{ color: 'var(--success)' }}
          >
            <CircleCheck aria-hidden size={40} strokeWidth={1.75} />
          </span>
          <h3 ref={titleRef} tabIndex={-1} className="text-title font-semibold outline-none">
            {t('export.successTitle')}
          </h3>
          <div className="flex w-full items-start gap-3 rounded-card border border-border p-3 text-left">
            <FileText aria-hidden size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-body font-medium" data-export-name>
                {phase.name}
              </p>
              <p className="text-caption text-text-muted">
                {fmtSize(phase.bytes.length)} · {t('export.downloads')} ·{' '}
                {t('export.originalUnchanged')}
              </p>
              {protectionLine(pc) ? (
                <p className="text-caption text-text-muted">{protectionLine(pc)}</p>
              ) : null}
            </div>
          </div>
          <div className="w-full text-left">
            <p className="text-body-sm font-semibold">{t('export.sha')}</p>
            <div className="flex items-start gap-2">
              <code data-sha256 className="min-w-0 flex-1 break-words font-mono text-body-sm">
                {phase.sha256.match(/.{1,4}/g)?.join(' ')}
              </code>
              <Button
                aria-label={t('export.copySha')}
                onClick={() => {
                  void navigator.clipboard.writeText(phase.sha256).then(() => {
                    showToast({ text: t('export.shaCopied') });
                  });
                }}
              >
                <Copy aria-hidden size={18} strokeWidth={1.75} />
              </Button>
            </div>
            <p className="text-caption text-text-muted">{t('export.shaHelp')}</p>
          </div>
          <div className="flex w-full flex-wrap justify-end gap-2">
            {services?.share ? (
              <Button
                onClick={() => {
                  void services.share?.shareFile(phase.name, phase.bytes, 'application/pdf');
                }}
              >
                {t('export.share')}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([phase.bytes.slice().buffer], { type: 'application/pdf' }),
                );
                window.open(url, '_blank', 'noopener');
                setTimeout(() => {
                  URL.revokeObjectURL(url);
                }, 60_000);
              }}
            >
              {t('export.open')}
            </Button>
            <Button variant="primary" onClick={onClose}>
              {t('export.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start(phone ? 'share' : 'save');
          }}
        >
          {pc ? <ProtectionNotice c={pc} /> : null}
          {busy ? (
            <p aria-live="polite" className="text-body-sm">
              {phase.stage}
            </p>
          ) : null}
          {phase.kind === 'error' ? (
            <div
              role="alert"
              className="flex gap-3 rounded-card border border-border p-3 text-text"
            >
              <TriangleAlert
                aria-hidden
                size={20}
                strokeWidth={1.75}
                className="shrink-0"
                style={{ color: 'var(--danger)' }}
              />
              <div className="flex flex-col gap-1">
                <p className="text-body-sm">
                  {phase.code === 'integrity'
                    ? t('export.integrity')
                    : phase.code === 'storage'
                      ? t('export.storageFull')
                      : t('export.failed')}
                </p>
                {phase.code !== 'integrity' ? (
                  <details className="text-caption">
                    <summary className="cursor-pointer">{t('export.details')}</summary>
                    <code className="font-mono">
                      {phase.code}: {phase.message}
                    </code>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}
          <label className="flex flex-col gap-1 text-body-sm">
            {t('export.fileName')}
            <span className="flex items-center gap-1">
              <input
                data-ui-state="input"
                autoFocus={!pc}
                value={stem}
                disabled={busy}
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className="min-h-target min-w-0 flex-1 rounded-input border border-border-strong bg-surface px-2 text-body text-text"
              />
              <span aria-hidden className="text-body">
                .pdf
              </span>
            </span>
            {nameError ? (
              <span className="text-body-sm" style={{ color: 'var(--danger)' }}>
                {nameError}
              </span>
            ) : null}
          </label>
          <Switch
            label={t('export.audit')}
            description={t('export.auditHelp')}
            checked={audit}
            onChange={setAudit}
          />
          {audit && !savedSigner ? (
            <label className="flex flex-col gap-1 text-body-sm">
              {t('export.auditName')}
              <input
                data-ui-state="input"
                autoComplete="name"
                value={signer ?? ''}
                onChange={(e) => {
                  setSigner(e.target.value);
                }}
                className="min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text"
              />
            </label>
          ) : null}
          {hasForm ? (
            <Switch
              label={t('export.flatten')}
              description={t('export.flattenHelp')}
              checked={flatten}
              onChange={setFlatten}
            />
          ) : null}
          <p className="flex items-center gap-2 text-caption text-text-muted">
            <Info aria-hidden size={16} strokeWidth={1.75} />
            <span>
              {t('export.legal')}{' '}
              <a
                href="#/settings"
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  navigate({ name: 'settings' });
                }}
                className="text-text underline"
              >
                {t('export.legalLink')}
              </a>
            </span>
          </p>
          {phone ? (
            <div className="flex flex-col gap-2">
              <Button type="submit" variant="primary" busy={busy} disabled={busy || !!nameError}>
                {busy ? t('export.saving') : t('export.share')}
              </Button>
              <Button
                disabled={busy || !!nameError}
                onClick={() => {
                  void start('save');
                }}
              >
                {t('export.saveToFiles')}
              </Button>
              {busy ? (
                <Button variant="ghost" onClick={() => job.current?.cancel()}>
                  {t('export.stop')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (busy) job.current?.cancel();
                  else onClose();
                }}
              >
                {busy ? t('export.stop') : t('export.cancel')}
              </Button>
              <Button type="submit" variant="primary" busy={busy} disabled={busy || !!nameError}>
                {busy
                  ? t('export.saving')
                  : phase.kind === 'error'
                    ? t('export.tryAgain')
                    : t('export.save')}
              </Button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
