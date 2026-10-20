/** Renders a saved signature in its own ink on the page colour (never inverted). */
import { useEffect, useState } from 'react';
import { parseStoredSvg } from '@dasignature/core';
import type { SignatureRecord } from '@dasignature/storage';
import { useApp } from '../state/app.ts';

const imageCache = new Map<string, Promise<string>>();

export function signatureImageUrl(sig: SignatureRecord): Promise<string> | undefined {
  if (!sig.image_ref) return undefined;
  let p = imageCache.get(sig.id);
  if (!p) {
    const store = useApp.getState().services?.store;
    if (!store) return undefined;
    p = store.getSignatureImage(sig).then((bytes) => {
      if (!bytes) throw new Error('missing image');
      return URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' }));
    });
    imageCache.set(sig.id, p);
  }
  return p;
}

export function forgetSignatureImage(id: string): void {
  void imageCache.get(id)?.then((u) => {
    URL.revokeObjectURL(u);
  });
  imageCache.delete(id);
}

export function SignatureGraphic({
  sig,
  className = '',
  label,
}: {
  sig: SignatureRecord;
  className?: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    void signatureImageUrl(sig)?.then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [sig]);
  const v = sig.svg_path ? parseStoredSvg(sig.svg_path) : null;
  if (v)
    return (
      <svg
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        viewBox={`0 0 ${String(v.width)} ${String(v.height)}`}
        preserveAspectRatio="xMidYMid meet"
        className={className}
      >
        <path d={v.d} fill={sig.color ?? 'var(--ink-black)'} fillOpacity={sig.opacity ?? 1} />
      </svg>
    );
  return url ? (
    <img
      src={url}
      alt={label ?? ''}
      className={`object-contain ${className}`}
      style={{ opacity: sig.opacity ?? 1 }}
      draggable={false}
    />
  ) : (
    <span className={className} />
  );
}
