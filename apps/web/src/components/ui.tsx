/** Small UI primitives following design/screens/components.md (tokens only, Lucide icons). */
import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, X } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { t } from '@dasignature/i18n';
import { useApp } from '../state/app.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-2',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
  danger: 'bg-danger text-on-danger hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pill?: boolean;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', pill, busy, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`inline-flex min-h-target min-w-target items-center justify-center gap-2 px-4 text-body-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-surface disabled:text-text-muted ${pill ? 'rounded-pill' : 'rounded-input'} ${VARIANT[variant]} ${className}`}
    >
      {busy ? (
        <LoaderCircle aria-hidden size={18} className="animate-spin motion-reduce:animate-none" />
      ) : null}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ label, className = '', children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex min-h-target min-w-target items-center justify-center rounded-input text-text hover:bg-surface-2 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return (
    <LoaderCircle
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      size={24}
      className="animate-spin text-text motion-reduce:animate-none"
    />
  );
}

/** Modal on tablet/desktop, bottom sheet on phone (same Radix Dialog). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && dismissable) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className={`fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-auto rounded-t-sheet border border-border bg-surface p-5 text-text shadow-float tablet:inset-x-auto tablet:bottom-auto tablet:left-1/2 tablet:top-1/2 tablet:w-[calc(100%-2rem)] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card ${wide ? 'tablet:max-w-[880px]' : 'tablet:max-w-[560px]'}`}
          onEscapeKeyDown={(e) => {
            if (!dismissable) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!dismissable) e.preventDefault();
          }}
        >
          <div
            className="mx-auto mb-3 h-1 w-9 rounded-pill bg-border-strong tablet:hidden"
            aria-hidden
          />
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-title font-semibold">{title}</Dialog.Title>
            {dismissable ? (
              <Dialog.Close asChild>
                <IconButton label={t('app.close')} className="-mr-2 -mt-2">
                  <X aria-hidden size={20} strokeWidth={1.75} />
                </IconButton>
              </Dialog.Close>
            ) : null}
          </div>
          {description ? (
            <Dialog.Description className="mt-2 text-body-sm text-text-muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Inverted pill toast, bottom center, 6 s, optional action (components.md). */
export function ToastHost() {
  const toast = useApp((s) => s.toast);
  const set = useApp((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => {
      if (useApp.getState().toast?.id === toast.id) set({ toast: undefined });
    }, 6000);
    return () => {
      clearTimeout(h);
    };
  }, [toast, set]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 desktop:bottom-8">
      {toast ? (
        <div
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-center gap-3 rounded-pill bg-text py-2 pl-5 pr-2 text-body-sm text-bg"
        >
          <span className="py-2">{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="min-h-target rounded-pill px-3 font-semibold text-bg underline-offset-2 hover:underline"
              onClick={() => {
                toast.action?.run();
                set({ toast: undefined });
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <span className="w-3" />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Chip({ status }: { status: 'draft' | 'signed' }) {
  return status === 'signed' ? (
    <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-success-chip-bg px-2 text-caption font-medium text-text">
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--success)"
        strokeWidth="2"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {t('library.signed')}
    </span>
  ) : (
    <span className="inline-flex h-6 items-center rounded-pill bg-surface-2 px-2 text-caption font-medium text-text">
      {t('library.draft')}
    </span>
  );
}
