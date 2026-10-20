/** Signatures gallery (design 05): default per kind, rename, duplicate-and-edit, delete + undo. */
import { MoreVertical, Plus, Signature as SignatureIcon, Star } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { t } from '@dasignature/i18n';
import type { SignatureRecord } from '@dasignature/storage';
import { Segmented } from '../components/controls.tsx';
import { SignatureGraphic, forgetSignatureImage } from '../components/SignaturePreview.tsx';
import { Button, IconButton, Modal } from '../components/ui.tsx';
import { useApp } from '../state/app.ts';

const Studio = lazy(() => import('./Studio.tsx'));

type Filter = 'all' | 'signature' | 'initials';

export function useSignatures() {
  const store = useApp((s) => s.services?.store);
  const [list, setList] = useState<SignatureRecord[] | undefined>();
  const refresh = useCallback(async () => {
    if (store) setList(await store.listSignatures());
  }, [store]);
  useEffect(() => {
    if (!store) return;
    let on = true;
    void store.listSignatures().then((l) => {
      if (on) setList(l);
    });
    return () => {
      on = false;
    };
  }, [store]);
  return { list, refresh };
}

const SOURCE: Record<SignatureRecord['source'], () => string> = {
  draw: () => t('signatures.sourceDraw'),
  type: () => t('signatures.sourceType'),
  image: () => t('signatures.sourceImage'),
  scan: () => t('signatures.sourceScan'),
};

function Card({
  sig,
  onChanged,
  onDuplicate,
  onDelete,
}: {
  sig: SignatureRecord;
  onChanged: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const store = useApp((s) => s.services?.store);
  const showToast = useApp((s) => s.showToast);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | undefined>();
  const kindLabel = sig.kind === 'initials' ? t('studio.initials') : t('studio.signature');
  const label = [
    sig.name,
    kindLabel.toLowerCase(),
    SOURCE[sig.source]().toLowerCase(),
    sig.is_default ? t('signatures.default').toLowerCase() : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li
      className="relative flex flex-col overflow-hidden rounded-card border border-border bg-surface"
      aria-label={label}
    >
      <div className="flex h-[120px] items-center justify-center border-b border-border bg-pdf-page p-3">
        <SignatureGraphic sig={sig} label={sig.name} className="h-full max-h-[96px] w-full" />
      </div>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming !== undefined ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = renaming.trim();
                if (!n || !store) return;
                void store.renameSignature(sig.id, n.slice(0, 60)).then(() => {
                  setRenaming(undefined);
                  onChanged();
                });
              }}
            >
              <input
                autoFocus
                aria-label={t('studio.name')}
                data-ui-state="input"
                value={renaming}
                maxLength={60}
                aria-invalid={!renaming.trim() || undefined}
                onChange={(e) => {
                  setRenaming(e.target.value);
                }}
                className={`min-h-target w-full rounded-input border bg-surface px-2 text-body text-text ${renaming.trim() ? 'border-border-strong' : 'border-danger'}`}
              />
              {!renaming.trim() ? (
                <p className="text-caption text-danger">{t('studio.nameRequired')}</p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={!renaming.trim()}>
                  {t('studio.save')}
                </Button>
                <Button
                  onClick={() => {
                    setRenaming(undefined);
                  }}
                >
                  {t('app.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="truncate text-body font-medium text-text">{sig.name}</p>
              <p className="text-caption text-text-muted">
                {kindLabel} · {SOURCE[sig.source]()}
              </p>
              {sig.is_default ? (
                <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-pill bg-surface-2 px-2 text-caption font-medium text-text">
                  <Star aria-hidden size={14} strokeWidth={1.75} />
                  {t('signatures.default')}
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="relative">
          <IconButton
            label={t('signatures.moreFor', { name: sig.name })}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => {
              setMenu(!menu);
            }}
          >
            <MoreVertical aria-hidden size={20} strokeWidth={1.75} />
          </IconButton>
          {menu ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-card border border-border bg-surface p-1 shadow-float"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenu(false);
              }}
            >
              {!sig.is_default ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-target w-full items-center rounded-input px-3 text-left text-body-sm text-text hover:bg-surface-2"
                  onClick={() => {
                    setMenu(false);
                    void store?.setDefaultSignature(sig.id).then(() => {
                      showToast({ text: t('signatures.madeDefault') });
                      onChanged();
                    });
                  }}
                >
                  {t('signatures.makeDefault')}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                autoFocus
                className="flex min-h-target w-full items-center rounded-input px-3 text-left text-body-sm text-text hover:bg-surface-2"
                onClick={() => {
                  setMenu(false);
                  setRenaming(sig.name);
                }}
              >
                {t('signatures.rename')}
              </button>
              {sig.source === 'draw' || sig.source === 'type' ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-target w-full items-center rounded-input px-3 text-left text-body-sm text-text hover:bg-surface-2"
                  onClick={() => {
                    setMenu(false);
                    onDuplicate();
                  }}
                >
                  {t('signatures.duplicate')}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex min-h-target w-full items-center rounded-input px-3 text-left text-body-sm text-danger hover:bg-surface-2"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                {t('signatures.delete')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function Signatures() {
  const { list, refresh } = useSignatures();
  const store = useApp((s) => s.services?.store);
  const showToast = useApp((s) => s.showToast);
  const [filter, setFilter] = useState<Filter>('all');
  const [studio, setStudio] = useState<
    { kind: 'signature' | 'initials'; from?: SignatureRecord } | undefined
  >();
  const [confirm, setConfirm] = useState<SignatureRecord | undefined>();
  const [hidden, setHidden] = useState<string[]>([]);

  const shown = (list ?? []).filter(
    (s) => !hidden.includes(s.id) && (filter === 'all' || s.kind === filter),
  );
  const none = (list ?? []).filter((s) => !hidden.includes(s.id)).length === 0;

  const del = (sig: SignatureRecord) => {
    setConfirm(undefined);
    setHidden((h) => [...h, sig.id]);
    const timer = setTimeout(() => {
      void store
        ?.deleteSignature(sig.id)
        .then(() => {
          forgetSignatureImage(sig.id);
          return refresh();
        })
        .finally(() => {
          setHidden((h) => h.filter((x) => x !== sig.id));
        });
    }, 6500);
    showToast({
      text: t('signatures.deleted'),
      action: {
        label: t('app.undo'),
        run: () => {
          clearTimeout(timer);
          setHidden((h) => h.filter((x) => x !== sig.id));
        },
      },
    });
  };

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4 tablet:p-6 desktop:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-headline font-semibold">{t('signatures.title')}</h1>
        {!none ? (
          <div className="w-full tablet:w-80">
            <Segmented
              label={t('signatures.filter')}
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('signatures.all') },
                { value: 'signature', label: t('signatures.onlySignatures') },
                { value: 'initials', label: t('signatures.onlyInitials') },
              ]}
            />
          </div>
        ) : null}
      </header>
      {list === undefined ? null : none ? (
        <section className="flex flex-col items-center gap-3 rounded-card border-[1.5px] border-dashed border-border-strong bg-surface px-6 py-12 text-center">
          <div
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-2"
            aria-hidden
          >
            <SignatureIcon size={40} strokeWidth={1.5} className="text-text" />
          </div>
          <h2 className="text-title font-semibold">{t('signatures.emptyTitle')}</h2>
          <p className="max-w-md text-body-sm text-text-muted">{t('signatures.emptyBody')}</p>
          <Button
            variant="primary"
            pill
            className="mt-2 px-6"
            onClick={() => {
              setStudio({ kind: 'signature' });
            }}
          >
            <Plus aria-hidden size={20} strokeWidth={1.75} />
            {t('signatures.create')}
          </Button>
        </section>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body-sm text-text">{t('signatures.noInitials')}</p>
          <Button
            onClick={() => {
              setStudio({ kind: 'initials' });
            }}
          >
            {t('signatures.createInitials')}
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {shown.map((s) => (
            <Card
              key={s.id}
              sig={s}
              onChanged={() => void refresh()}
              onDuplicate={() => {
                setStudio({ kind: s.kind, from: s });
              }}
              onDelete={() => {
                setConfirm(s);
              }}
            />
          ))}
        </ul>
      )}
      {!none ? (
        <div className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 tablet:bottom-6 desktop:left-auto desktop:right-8 desktop:translate-x-0">
          <Button
            variant="primary"
            pill
            className="px-6 shadow-float"
            onClick={() => {
              setStudio({ kind: filter === 'initials' ? 'initials' : 'signature' });
            }}
          >
            <Plus aria-hidden size={20} strokeWidth={1.75} />
            {t('signatures.newSignature')}
          </Button>
        </div>
      ) : null}
      {studio ? (
        <Suspense fallback={null}>
          <Studio
            open
            initialKind={studio.kind}
            from={studio.from}
            onClose={() => {
              setStudio(undefined);
              void refresh();
            }}
          />
        </Suspense>
      ) : null}
      <Modal
        open={confirm !== undefined}
        onClose={() => {
          setConfirm(undefined);
        }}
        title={t('signatures.deleteTitle', { name: confirm?.name ?? '' })}
        description={t('signatures.deleteBody')}
      >
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              setConfirm(undefined);
            }}
          >
            {t('app.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm) del(confirm);
            }}
          >
            {t('signatures.delete')}
          </Button>
        </div>
      </Modal>
    </main>
  );
}
