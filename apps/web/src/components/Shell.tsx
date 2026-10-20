/**
 * Navigation chrome (design D1): phone bottom tabs, tablet 88 px rail, desktop 232 px sidebar
 * with the "Stored on this device only" footer.
 */
import { FileText, Lock, PenLine, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@dasignature/i18n';
import { hrefFor, type Route } from '../state/route.ts';

const ITEMS = [
  { route: { name: 'library' } as Route, label: () => t('nav.library'), Icon: FileText },
  { route: { name: 'signatures' } as Route, label: () => t('nav.signatures'), Icon: PenLine },
  { route: { name: 'settings' } as Route, label: () => t('nav.settings'), Icon: Settings },
];

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-bg text-text">
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] tablet:static tablet:w-[88px] tablet:flex-col tablet:items-center tablet:gap-1 tablet:border-r tablet:border-t-0 tablet:pt-4 desktop:w-[232px] desktop:items-stretch desktop:px-3"
      >
        <div className="hidden items-center gap-2 px-2 pb-4 tablet:flex">
          <img src="/favicon.svg" alt="" width={32} height={32} data-decorative />
          <span className="hidden text-body font-semibold tracking-wordmark desktop:inline">
            <span className="font-normal">Da</span>Signature
          </span>
        </div>
        {ITEMS.map(({ route: r, label, Icon }) => {
          const active = r.name === route.name || (r.name === 'library' && route.name === 'doc');
          // Active: --surface-2 fill with --text; inactive: --text-muted on --surface (PM #31).
          const tone = active ? 'text-text tablet:bg-surface-2' : 'text-text-muted';
          return (
            <a
              key={r.name}
              href={hrefFor(r)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-input text-caption font-medium tablet:w-[72px] tablet:flex-none tablet:py-2 desktop:w-auto desktop:flex-row desktop:justify-start desktop:gap-3 desktop:px-3 desktop:text-body-sm ${tone}`}
            >
              <Icon
                aria-hidden
                size={20}
                strokeWidth={1.75}
                className={active ? 'text-primary' : ''}
              />
              {label()}
            </a>
          );
        })}
        <p className="mt-auto hidden items-center gap-2 px-3 py-4 text-caption text-text-muted desktop:flex">
          <Lock aria-hidden size={16} strokeWidth={1.75} />
          {t('app.storedLocally')}
        </p>
      </nav>
      <div className="min-w-0 flex-1 pb-20 tablet:pb-0">{children}</div>
    </div>
  );
}
