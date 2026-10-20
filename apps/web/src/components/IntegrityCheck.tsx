/** Signed-document integrity check (SPEC Sec 3.2): file hash vs local exports + embedded trail. */
import { useState } from 'react';
import { t } from '@dasignature/i18n';
import type { TrailEntry } from '@dasignature/pdf/export';
import { Button } from './ui.tsx';
import { pickFiles } from '../services/files.ts';
import { useApp } from '../state/app.ts';

interface Result {
  name: string;
  match: { title: string; date: string } | undefined;
  trail: TrailEntry[];
}

export function IntegrityCheck() {
  const services = useApp((s) => s.services);
  const [result, setResult] = useState<Result | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3">
      <p className="text-body-sm text-text">{t('integrity.help')}</p>
      <div>
        <Button
          busy={busy}
          onClick={() => {
            void (async () => {
              const [file] = await pickFiles();
              if (!file || !services) return;
              setBusy(true);
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const { readTrail, sha256Hex } = await import('@dasignature/pdf/export');
                const sha = await sha256Hex(bytes);
                const hit = await services.store.findExportBySha256(sha);
                const trail = await readTrail(bytes).catch(() => []);
                setResult({
                  name: file.name,
                  match: hit
                    ? {
                        title: hit.title ?? '',
                        date: new Date(hit.export.created_at).toLocaleString(),
                      }
                    : undefined,
                  trail,
                });
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {t('integrity.pick')}
        </Button>
      </div>
      {result ? (
        <div
          data-integrity-result
          className="flex flex-col gap-2 text-body-sm text-text"
          aria-live="polite"
        >
          <p className="font-semibold">{result.name}</p>
          <p data-integrity-match={result.match ? 'yes' : 'no'}>
            {result.match
              ? t('integrity.match', { title: result.match.title, date: result.match.date })
              : t('integrity.noMatch')}
          </p>
          <p className="font-semibold">{t('integrity.trail')}</p>
          {result.trail.length ? (
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {result.trail.map((e, i) => (
                <li key={i}>
                  {t('integrity.entry', {
                    signer: e.signer || '—',
                    at: e.at,
                    app: e.app,
                    platform: e.platform,
                  })}
                  <br />
                  <code className="break-all font-mono text-caption">
                    {t('integrity.source', { sha: e.sourceSha256 })}
                  </code>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t('integrity.noTrail')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
