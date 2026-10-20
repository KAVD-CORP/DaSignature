/** Library (design 02-library): recent documents, search, Open PDF, empty-state drop zone. */
import { FileText, FileUp, Info, MoreVertical, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@dasignature/i18n';
import type { DocumentRecord } from '@dasignature/storage';
import { Button, Chip, IconButton, Modal } from '../components/ui.tsx';
import { importPdf } from '../services/import.ts';
import { pickFiles } from '../services/files.ts';
import { session } from '../services/session.ts';
import { useApp } from '../state/app.ts';
import { navigate } from '../state/route.ts';

/** Case- and accent-insensitive match (design 02-library search). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

const PERSIST_NOTE_KEY = 'web.persistNoteShown';

export async function openFiles(files: File[]): Promise<void> {
  const [first] = files;
  if (!first) return;
  if (files.length > 1)
    useApp.getState().showToast({ text: t('library.multiDrop', { count: String(files.length) }) });
  const rec = await importPdf(first);
  if (!rec) return;
  await maybePersist();
  navigate({ name: 'doc', id: rec.id });
}

/** After the first import on web: ask for persistent storage and show the one-time note. */
async function maybePersist(): Promise<void> {
  const s = useApp.getState().services;
  if (!s?.persist) return;
  if (await s.store.getSetting(PERSIST_NOTE_KEY).catch(() => '1')) return;
  const persisted = await s.persist();
  await s.store.setSetting(PERSIST_NOTE_KEY, persisted ? 'persisted' : 'shown');
  useApp.getState().set({ persistNote: true });
}

export async function openPicker(): Promise<void> {
  await openFiles(await pickFiles());
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function DocCard({ doc, onDelete }: { doc: DocumentRecord; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <li className="relative">
      <a
        href={`#/doc/${doc.id}`}
        aria-label={`${doc.title}, ${doc.status === 'signed' ? t('library.signed') : t('library.draft')}`}
        className="block overflow-hidden rounded-card border border-border bg-surface hover:border-border-strong"
      >
        <div className="flex aspect-[4/3] items-center justify-center bg-surface-2" aria-hidden>
          <div className="flex h-[80%] aspect-[0.77] items-center justify-center border border-border bg-pdf-page">
            <FileText size={28} strokeWidth={1.5} className="text-pdf-ink" />
          </div>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <span className="truncate pr-8 text-body-sm font-semibold">{doc.title}</span>
          <span className="text-caption text-text-muted">
            {doc.page_count === 1
              ? t('library.onePage')
              : t('library.pages', { count: String(doc.page_count) })}{' '}
            · {t('library.edited', { date: formatDate(doc.updated_at) })}
          </span>
          <span>
            <Chip status={doc.status} />
          </span>
        </div>
      </a>
      <div className="absolute bottom-2 right-2">
        <IconButton
          label={t('library.moreFor', { title: doc.title })}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
          }}
          className="border border-border bg-surface"
        >
          <MoreVertical aria-hidden size={20} strokeWidth={1.75} />
        </IconButton>
        {menu ? (
          <div
            role="menu"
            className="absolute bottom-full right-0 z-10 mb-1 min-w-40 rounded-card border border-border bg-surface p-1 shadow-float"
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              className="flex min-h-target w-full items-center gap-2 rounded-input px-3 text-body-sm text-danger hover:bg-surface-2"
              onClick={() => {
                setMenu(false);
                onDelete();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenu(false);
              }}
            >
              <Trash2 aria-hidden size={18} strokeWidth={1.75} />
              {t('library.delete')}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function Library() {
  const docs = useApp((s) => s.docs);
  const pending = useApp((s) => s.pendingDelete);
  const persistNote = useApp((s) => s.persistNote);
  const set = useApp((s) => s.set);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<DocumentRecord | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return docs.filter((d) => !pending.includes(d.id) && (!q || fold(d.title).includes(q)));
  }, [docs, pending, query]);
  const empty = docs.filter((d) => !pending.includes(d.id)).length === 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openPicker();
      } else if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void openFiles([...(e.dataTransfer?.files ?? [])]);
    };
    addEventListener('keydown', onKey);
    addEventListener('dragenter', enter);
    addEventListener('dragleave', leave);
    addEventListener('dragover', over);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('dragenter', enter);
      removeEventListener('dragleave', leave);
      removeEventListener('dragover', over);
      removeEventListener('drop', drop);
    };
  }, []);

  const doDelete = (doc: DocumentRecord) => {
    setConfirm(undefined);
    set({ pendingDelete: [...useApp.getState().pendingDelete, doc.id] });
    const restore = () => {
      clearTimeout(timer);
      set({ pendingDelete: useApp.getState().pendingDelete.filter((x) => x !== doc.id) });
    };
    // Soft delete for the 6 s undo window, then the real (cascading) delete.
    const timer = setTimeout(() => {
      const s = useApp.getState().services;
      void s?.store
        .deleteDocument(doc.id)
        .then(() => {
          session.forget(doc.id);
          return useApp.getState().refreshDocs();
        })
        .finally(restore);
    }, 6500);
    useApp
      .getState()
      .showToast({ text: t('library.deleted'), action: { label: t('app.undo'), run: restore } });
  };

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4 tablet:p-6 desktop:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-headline font-semibold">{t('library.title')}</h1>
        {!empty ? (
          <div role="search" className="relative w-full tablet:w-72">
            <Search
              aria-hidden
              size={18}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              ref={searchRef}
              type="search"
              aria-label={t('library.search')}
              placeholder={t('library.search')}
              data-ui-state="input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="min-h-target w-full rounded-input border border-border-strong bg-surface pl-9 pr-3 text-body text-text placeholder:text-text-muted"
            />
          </div>
        ) : null}
      </header>

      {persistNote ? (
        <div
          role="note"
          className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-2 p-3 text-body-sm text-text"
        >
          <Info aria-hidden size={20} strokeWidth={1.75} />
          <span className="min-w-0 flex-1">{t('library.persistNote')}</span>
          <Button
            variant="ghost"
            onClick={() => {
              set({ persistNote: false });
              location.hash = '#/settings';
            }}
          >
            {t('library.backupNow')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              set({ persistNote: false });
            }}
          >
            {t('app.dismiss')}
          </Button>
        </div>
      ) : null}

      {empty ? (
        <section
          aria-labelledby="empty-title"
          className={`flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-12 text-center ${dragging ? 'border-2 border-solid border-focus-ring bg-surface-2' : 'border-[1.5px] border-dashed border-border-strong'}`}
        >
          <div
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-2"
            aria-hidden
          >
            <FileUp size={40} strokeWidth={1.5} className="text-text" />
          </div>
          <h2 id="empty-title" className="text-title font-semibold" aria-live="polite">
            {dragging ? t('library.dropToOpen') : t('library.emptyTitle')}
          </h2>
          <p className={`max-w-md text-body-sm ${dragging ? 'text-text' : 'text-text-muted'}`}>
            {t('library.emptyBody')}
          </p>
          <Button variant="primary" pill onClick={() => void openPicker()} className="mt-2 px-6">
            <Plus aria-hidden size={20} strokeWidth={1.75} />
            {t('library.openPdf')}
          </Button>
          <p className={`text-caption ${dragging ? 'text-text' : 'text-text-muted'}`}>
            {t('library.emptyDrop')}
          </p>
        </section>
      ) : (
        <>
          {visible.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('library.noResults', { query })}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3 tablet:gap-4 desktop:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {visible.map((d) => (
                <DocCard
                  key={d.id}
                  doc={d}
                  onDelete={() => {
                    setConfirm(d);
                  }}
                />
              ))}
            </ul>
          )}
          <div className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 tablet:bottom-6 desktop:left-auto desktop:right-8 desktop:translate-x-0">
            <Button
              variant="primary"
              pill
              onClick={() => void openPicker()}
              className="px-6 shadow-float"
            >
              <Plus aria-hidden size={20} strokeWidth={1.75} />
              {t('library.openPdf')}
            </Button>
          </div>
          {dragging ? (
            <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-scrim">
              <p className="rounded-card border-2 border-focus-ring bg-surface px-8 py-6 text-title font-semibold text-text">
                {t('library.dropToOpen')}
              </p>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={confirm !== undefined}
        onClose={() => {
          setConfirm(undefined);
        }}
        title={t('library.deleteTitle', { title: confirm?.title ?? '' })}
        description={t('library.deleteBody')}
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
              if (confirm) doDelete(confirm);
            }}
          >
            {t('library.delete')}
          </Button>
        </div>
      </Modal>
    </main>
  );
}
