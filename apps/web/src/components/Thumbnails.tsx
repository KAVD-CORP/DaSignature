/**
 * Page thumbnails (design 03-editor): lazily rendered when scrolled into view, kept as small
 * image blobs (not live canvases, PERF-04), current page outlined with --focus-ring.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '@dasignature/i18n';
import { renderPage, type PDFDocumentProxy } from '@dasignature/pdf/render';
import type { PageSize } from './PdfViewer.tsx';

const THUMB_W = 120;
const cache = new WeakMap<PDFDocumentProxy, Map<number, string>>();
let queue: Promise<void> = Promise.resolve();

export function releaseThumbnails(pdf: PDFDocumentProxy): void {
  for (const url of cache.get(pdf)?.values() ?? []) URL.revokeObjectURL(url);
  cache.delete(pdf);
}

function thumbUrl(pdf: PDFDocumentProxy, index: number): Promise<string> {
  let m = cache.get(pdf);
  if (!m) {
    m = new Map<number, string>();
    cache.set(pdf, m);
  }
  const hit = m.get(index);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const page = await pdf.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    await renderPage(page, canvas, THUMB_W / vp.width, 1.5).promise;
    const blob = await new Promise<Blob | null>((r) => {
      canvas.toBlob(r, 'image/png');
    });
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('thumbnail failed');
    const url = URL.createObjectURL(blob);
    m.set(index, url);
    return url;
  });
  queue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

function Thumb({
  pdf,
  index,
  count,
  size,
  current,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  count: number;
  size: PageSize;
  current: boolean;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | undefined>(() => cache.get(pdf)?.get(index));
  useEffect(() => {
    if (url) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void thumbUrl(pdf, index)
        .then((u) => {
          if (alive) setUrl(u);
        })
        .catch(() => undefined);
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [pdf, index, url]);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={current}
      aria-label={t('viewer.pageOf', { page: String(index + 1), count: String(count) })}
      data-ui-state={current ? 'selected' : undefined}
      onClick={() => {
        onSelect(index);
      }}
      className="flex w-full flex-col items-center gap-1 rounded-input p-2 hover:bg-surface-2"
    >
      <span
        className={`block border border-border bg-pdf-page ${current ? 'outline outline-2 outline-offset-2 outline-focus-ring' : ''}`}
        style={{ width: THUMB_W, height: (THUMB_W * size.height) / size.width }}
      >
        {url ? <img src={url} alt="" className="block h-full w-full" /> : null}
      </span>
      <span className={`text-caption text-text ${current ? 'font-semibold' : ''}`}>
        {index + 1}
      </span>
    </button>
  );
}

export function Thumbnails({
  pdf,
  sizes,
  current,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  sizes: readonly PageSize[];
  current: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div role="listbox" aria-label={t('viewer.pages')} className="flex flex-col gap-1 p-2">
      {sizes.map((s, i) => (
        <Thumb
          key={i}
          pdf={pdf}
          index={i}
          count={sizes.length}
          size={s}
          current={i === current}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
