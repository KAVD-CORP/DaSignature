import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { t } from '@dasignature/i18n';
import { useApp, type PasswordRequest } from '../state/app.ts';
import { Button, IconButton, Modal } from './ui.tsx';

function PasswordDialog() {
  const req = useApp((s) => s.password);
  if (!req) return null;
  return <PasswordForm key={req.retry ? 'retry' : 'first'} req={req} />;
}

function PasswordForm({ req }: { req: PasswordRequest }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const id = useId();
  const submit = () => {
    if (pw) req.resolve(pw);
  };
  return (
    <Modal
      open
      onClose={() => {
        req.resolve(null);
      }}
      title={t('password.title')}
      description={t('password.body')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="mb-1 block text-body-sm font-medium">
          {t('password.label')}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type={show ? 'text' : 'password'}
            autoComplete="off"
            autoFocus
            data-ui-state="input"
            aria-invalid={req.retry || undefined}
            aria-describedby={req.retry ? `${id}-err` : undefined}
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
            }}
            className={`min-h-target w-full rounded-input border bg-surface px-3 text-body text-text ${req.retry ? 'border-danger' : 'border-border-strong'}`}
          />
          <IconButton
            label={show ? t('password.hide') : t('password.show')}
            onClick={() => {
              setShow(!show);
            }}
          >
            {show ? (
              <EyeOff aria-hidden size={20} strokeWidth={1.75} />
            ) : (
              <Eye aria-hidden size={20} strokeWidth={1.75} />
            )}
          </IconButton>
        </div>
        {req.retry ? (
          <p id={`${id}-err`} role="alert" className="mt-1 text-body-sm text-danger">
            {t('password.wrong')}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            onClick={() => {
              req.resolve(null);
            }}
          >
            {t('app.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!pw}>
            {t('password.open')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OpeningDialog() {
  const opening = useApp((s) => s.opening);
  const password = useApp((s) => s.password);
  if (!opening || password) return null;
  return (
    <Modal
      open
      dismissable={false}
      onClose={opening.cancel}
      title={t('library.opening', { name: opening.name })}
      description={opening.large ? t('library.large') : undefined}
    >
      <div
        role="progressbar"
        aria-label={t('library.opening', { name: opening.name })}
        className="h-1 w-full overflow-hidden rounded-pill bg-surface-2"
      >
        <div className="h-full w-1/3 animate-pulse rounded-pill bg-primary motion-reduce:animate-none" />
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={opening.cancel}>{t('app.cancel')}</Button>
      </div>
    </Modal>
  );
}

function AlertDialog() {
  const alert = useApp((s) => s.alert);
  const set = useApp((s) => s.set);
  if (!alert) return null;
  const close = () => {
    set({ alert: undefined });
  };
  return (
    <Modal open onClose={close} title={alert}>
      <div className="flex justify-end">
        <Button variant="primary" onClick={close}>
          {t('app.ok')}
        </Button>
      </div>
    </Modal>
  );
}

export function GlobalDialogs() {
  return (
    <>
      <OpeningDialog />
      <PasswordDialog />
      <AlertDialog />
    </>
  );
}
