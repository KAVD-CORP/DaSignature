/** Editor side panel, phone dock, properties and small editor chrome (design 03). */
import {
  CalendarDays,
  CheckSquare,
  Copy,
  PenLine,
  Plus,
  Redo2,
  Signature,
  Trash2,
  Type,
  Undo2,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DATE_FORMATS, formatDate, todayIso, type FieldType } from '@dasignature/core';
import { t } from '@dasignature/i18n';
import type { SignatureRecord } from '@dasignature/storage';
import { Checkbox, Slider } from './controls.tsx';
import { Button, IconButton } from './ui.tsx';
import { SignatureGraphic } from './SignaturePreview.tsx';
import { FIELD_LABEL, textWidthPt } from './PlacementLayer.tsx';
import { placements, usePlacements, type Placed } from '../state/placements.ts';
import type { PageSize } from './PdfViewer.tsx';

const TOOL_ICON: Record<FieldType, typeof Signature> = {
  signature: Signature,
  initials: PenLine,
  date: CalendarDays,
  text: Type,
  checkbox: CheckSquare,
  name: UserRound,
};
const TOOL_ADD: Record<FieldType, Parameters<typeof t>[0]> = {
  signature: 'editor.addSignature',
  initials: 'editor.addInitials',
  date: 'editor.addDate',
  text: 'editor.addText',
  checkbox: 'editor.addCheckbox',
  name: 'editor.addName',
};
export const TOOLS: FieldType[] = ['signature', 'initials', 'date', 'text', 'checkbox', 'name'];

export function ToolButton({
  type,
  onPick,
  compact,
}: {
  type: FieldType;
  onPick: (t: FieldType, signatureId?: string, keyboard?: boolean) => void;
  compact?: boolean;
}) {
  const tool = usePlacements((s) => s.tool);
  const Icon = TOOL_ICON[type];
  const active = tool === type;
  return (
    <button
      type="button"
      aria-label={t(TOOL_ADD[type])}
      aria-pressed={active}
      onClick={(e) => {
        onPick(type, undefined, e.detail === 0);
      }}
      className={`flex min-h-touch min-w-target flex-col items-center justify-center gap-0.5 rounded-input px-2 text-caption text-text ${
        active ? 'bg-surface-2 outline outline-2 outline-focus-ring' : 'hover:bg-surface-2'
      } ${compact ? '' : 'border border-border'}`}
    >
      <Icon aria-hidden size={20} strokeWidth={1.75} />
      <span aria-hidden>{t(FIELD_LABEL[type])}</span>
    </button>
  );
}

export function UndoRedo() {
  const canUndo = usePlacements((s) => s.canUndo);
  const canRedo = usePlacements((s) => s.canRedo);
  return (
    <>
      <IconButton
        label={t('editor.undo')}
        disabled={!canUndo}
        onClick={() => {
          placements.undo();
        }}
      >
        <Undo2 aria-hidden size={20} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label={t('editor.redo')}
        disabled={!canRedo}
        onClick={() => {
          placements.redo();
        }}
      >
        <Redo2 aria-hidden size={20} strokeWidth={1.75} />
      </IconButton>
    </>
  );
}

/** "Saved" for 2 s after each autosave; remounted (keyed) per save. */
export function SavedCaption() {
  const savedAt = usePlacements((s) => s.savedAt);
  return savedAt ? <SavedFlash key={savedAt} /> : null;
}
function SavedFlash() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const h = setTimeout(() => {
      setShow(false);
    }, 2000);
    return () => {
      clearTimeout(h);
    };
  }, []);
  return show ? (
    <span data-saved className="px-1 text-caption text-text-muted">
      {t('editor.saved')}
    </span>
  ) : null;
}

export function LiveRegion() {
  const live = usePlacements((s) => s.live);
  return (
    <div aria-live="polite" className="sr-only">
      {live}
    </div>
  );
}

export function Properties({ sizes, locale }: { sizes: readonly PageSize[]; locale?: string }) {
  const sel = usePlacements((s) => s.items.find((i) => i.id === s.selected));
  const lockAspect = usePlacements((s) => s.lockAspect);
  if (!sel) return <p className="text-body-sm text-text-muted">{t('editor.noSelection')}</p>;
  const size = sizes[sel.page];
  const isText = sel.type === 'text' || sel.type === 'name';
  const setText = (text: string) => {
    if (!size) return;
    const hPt = sel.h * size.height;
    const wPt = textWidthPt(
      sel.type === 'date' ? formatDate(text, sel.data.format ?? '', locale) : text,
      hPt,
    );
    placements.update(
      sel.id,
      { data: { ...sel.data, text }, w: Math.max(wPt, 24) / size.width },
      'text',
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {isText ? (
        <label className="flex flex-col gap-1 text-body-sm">
          {t('editor.textValue')}
          <input
            data-autofocus-text
            data-ui-state="input"
            value={sel.data.text ?? ''}
            placeholder={t('editor.textPlaceholder')}
            onChange={(e) => {
              setText(e.target.value);
            }}
            className="min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text"
          />
        </label>
      ) : null}
      {sel.type === 'date' ? (
        <>
          <label className="flex flex-col gap-1 text-body-sm">
            {t('editor.toolDate')}
            <input
              type="date"
              data-ui-state="input"
              value={sel.data.text ?? todayIso()}
              onChange={(e) => {
                if (e.target.value) setText(e.target.value);
              }}
              className="min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            {t('editor.dateFormat')}
            <select
              data-ui-state="input"
              value={sel.data.format ?? 'locale-medium'}
              onChange={(e) => {
                if (!size) return;
                const format = e.target.value;
                const hPt = sel.h * size.height;
                const wPt = textWidthPt(formatDate(sel.data.text ?? '', format, locale), hPt);
                placements.update(sel.id, {
                  data: { ...sel.data, format },
                  w: Math.max(wPt, 24) / size.width,
                });
              }}
              className="min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text"
            >
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatDate(sel.data.text ?? todayIso(), f, locale)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {sel.type === 'checkbox' ? (
        <Checkbox
          label={t('editor.checked')}
          checked={sel.data.checked ?? false}
          onChange={(checked) => {
            placements.update(sel.id, { data: { ...sel.data, checked } });
          }}
        />
      ) : null}
      <Slider
        label={t('editor.opacity')}
        value={Math.round(sel.opacity * 100)}
        min={10}
        max={100}
        step={5}
        format={(v) => `${String(v)}%`}
        onChange={(v) => {
          placements.update(sel.id, { opacity: v / 100 }, 'opacity');
        }}
      />
      <Slider
        label={t('editor.rotation')}
        value={sel.rotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${String(v)}°`}
        onChange={(v) => {
          placements.update(sel.id, { rotation: v }, 'rotation');
        }}
      />
      {sel.type !== 'checkbox' ? (
        <Checkbox
          label={t('editor.lockAspect')}
          checked={lockAspect}
          onChange={(v) => {
            placements.setLockAspect(v);
          }}
        />
      ) : null}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            placements.duplicate(sel.id);
          }}
        >
          <Copy aria-hidden size={18} strokeWidth={1.75} />
          {t('editor.duplicate')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            placements.remove(sel.id);
            placements.announce(t('editor.deleted'));
          }}
        >
          <Trash2 aria-hidden size={18} strokeWidth={1.75} />
          {t('editor.delete')}
        </Button>
      </div>
    </div>
  );
}

export function SidePanel({
  sigs,
  sizes,
  onPick,
  onNewSignature,
}: {
  sigs: readonly SignatureRecord[] | undefined;
  sizes: readonly PageSize[];
  onPick: (t: FieldType, signatureId?: string, keyboard?: boolean) => void;
  onNewSignature: () => void;
}) {
  const tool = usePlacements((s) => s.tool);
  const toolSig = usePlacements((s) => s.toolSignature);
  return (
    <aside
      aria-label={t('editor.tools')}
      className="hidden w-[280px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-4 tablet:flex desktop:w-[300px]"
    >
      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-muted">
          {t('editor.signatures')}
        </h2>
        {sigs && sigs.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2">
            {sigs.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`${s.name}, ${t(FIELD_LABEL[s.kind])}`}
                  aria-pressed={tool === s.kind && toolSig === s.id}
                  onClick={(e) => {
                    onPick(s.kind, s.id, e.detail === 0);
                  }}
                  className={`flex h-16 w-full items-center justify-center rounded-input border border-border bg-pdf-page p-1 ${
                    tool === s.kind && toolSig === s.id
                      ? 'outline outline-2 outline-focus-ring'
                      : ''
                  }`}
                >
                  <SignatureGraphic sig={s} className="h-full w-full" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button onClick={onNewSignature}>
          <Plus aria-hidden size={18} strokeWidth={1.75} />
          {sigs && sigs.length > 0 ? t('editor.newSignature') : t('editor.createSignature')}
        </Button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-muted">
          {t('editor.fields')}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {TOOLS.map((ty) => (
            <ToolButton key={ty} type={ty} onPick={onPick} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-muted">
          {t('editor.properties')}
        </h2>
        <Properties sizes={sizes} />
      </section>
    </aside>
  );
}

export function PhoneDock({
  onPick,
}: {
  onPick: (t: FieldType, signatureId?: string, keyboard?: boolean) => void;
}) {
  return (
    <nav
      aria-label={t('editor.tools')}
      className="flex shrink-0 justify-around gap-1 overflow-x-auto border-t border-border bg-surface px-2 py-1 tablet:hidden"
    >
      {TOOLS.map((ty) => (
        <ToolButton key={ty} type={ty} onPick={onPick} compact />
      ))}
    </nav>
  );
}

export function ToolHint({ onCancel }: { onCancel: () => void }) {
  const tool = usePlacements((s) => s.tool);
  if (!tool) return null;
  return (
    <div
      role="status"
      className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-pill border border-border bg-surface py-1 pl-4 pr-1 text-body-sm text-text shadow-float"
    >
      <span>{t('editor.tapToPlace')}</span>
      <Button onClick={onCancel}>{t('editor.cancelTool')}</Button>
    </div>
  );
}

export type { Placed };
