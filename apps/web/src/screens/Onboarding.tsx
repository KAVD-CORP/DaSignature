/**
 * First-run introduction (design 01-onboarding, SPEC Sec 8.4): three skippable cards, then an
 * optional signer-name step. Shown once; Settings › About › "Show introduction" brings it back.
 */
import { CodeXml, PenLine, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t, type MessageKey } from '@dasignature/i18n';
import { Button } from '../components/ui.tsx';
import { useApp } from '../state/app.ts';

export const ONBOARDING_KEY = 'onboarding.done';
const SIGNER_KEY = 'signer_name';

const CARDS: { Icon: LucideIcon; title: MessageKey; body: MessageKey }[] = [
  { Icon: ShieldCheck, title: 'onboarding.card1Title', body: 'onboarding.card1Body' },
  { Icon: PenLine, title: 'onboarding.card2Title', body: 'onboarding.card2Body' },
  { Icon: CodeXml, title: 'onboarding.card3Title', body: 'onboarding.card3Body' },
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const onName = step === CARDS.length;

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const finish = async (signer?: string) => {
    const { services, set } = useApp.getState();
    const store = services?.store;
    const trimmed = signer?.trim();
    if (store) {
      if (trimmed) await store.setSetting(SIGNER_KEY, trimmed.slice(0, 120));
      await store.setSetting(ONBOARDING_KEY, '1');
    }
    set({ intro: false });
    location.hash = '#/';
  };

  const onKey = (e: KeyboardEvent) => {
    if (onName || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') setStep((s) => Math.min(CARDS.length, s + 1));
    if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
  };

  const card = CARDS[step];
  const Icon = card?.Icon ?? User;
  return (
    <main
      className="flex min-h-dvh items-stretch justify-center bg-bg text-text tablet:items-center tablet:p-6"
      onKeyDown={onKey}
      aria-label={t('onboarding.label')}
    >
      <div className="flex w-full flex-col gap-6 p-5 tablet:min-h-[560px] tablet:max-w-[560px] tablet:rounded-card tablet:border tablet:border-border tablet:bg-surface tablet:p-8">
        <div className="flex items-center justify-between">
          {onName ? (
            <Button
              variant="ghost"
              onClick={() => {
                setStep(CARDS.length - 1);
              }}
            >
              {t('onboarding.back')}
            </Button>
          ) : (
            <img src="/favicon.svg" alt="DaSignature" width={32} height={32} />
          )}
          {onName ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setStep(CARDS.length);
              }}
            >
              {t('onboarding.skip')}
            </Button>
          )}
        </div>
        <div
          key={step}
          className="ds-onboarding-card flex flex-1 flex-col items-center justify-center gap-4 text-center tablet:items-start tablet:text-start"
        >
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-surface-2">
            <Icon size={40} aria-hidden="true" />
          </span>
          <h1
            ref={heading}
            tabIndex={-1}
            aria-live="polite"
            className="text-headline font-semibold outline-none"
          >
            {t(card ? card.title : 'onboarding.nameTitle')}
          </h1>
          <p className="max-w-[440px] text-body text-text-muted">
            {t(card ? card.body : 'onboarding.nameBody')}
          </p>
          {onName ? (
            <form
              className="flex w-full max-w-[440px] flex-col gap-2 text-start"
              onSubmit={(e) => {
                e.preventDefault();
                void finish(name);
              }}
            >
              <label htmlFor="onboarding-name" className="text-body-sm font-medium">
                {t('onboarding.nameLabel')}
              </label>
              <input
                id="onboarding-name"
                autoComplete="name"
                maxLength={120}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className="min-h-touch rounded-input border border-border-strong bg-surface px-3 text-body text-text"
              />
            </form>
          ) : null}
        </div>
        {onName ? (
          <div className="flex flex-col gap-2 tablet:flex-row-reverse tablet:justify-start">
            <Button variant="primary" onClick={() => void finish(name)}>
              {t('onboarding.continue')}
            </Button>
            <Button variant="ghost" onClick={() => void finish()}>
              {t('onboarding.skipForNow')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse items-center gap-4 tablet:flex-row tablet:justify-between">
            <div role="tablist" aria-label={t('onboarding.label')} className="flex gap-2">
              {CARDS.map((c, i) => (
                <button
                  key={c.title}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  aria-label={t('onboarding.step', {
                    n: String(i + 1),
                    total: String(CARDS.length),
                  })}
                  onClick={() => {
                    setStep(i);
                  }}
                  className={`h-2 rounded-pill transition-all ${i === step ? 'w-6 bg-primary' : 'w-2 bg-border-strong'}`}
                />
              ))}
            </div>
            <Button
              variant="primary"
              className="w-full tablet:w-auto"
              onClick={() => {
                setStep(step + 1);
              }}
            >
              {step === CARDS.length - 1 ? t('onboarding.getStarted') : t('onboarding.next')}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
