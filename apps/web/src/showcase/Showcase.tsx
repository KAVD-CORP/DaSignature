import { useId, useState, type ReactNode } from 'react';
import glyphUrl from '@dasignature/ui/icons/glyph-navy.svg?url';

/**
 * Token showcase (QA / Designer review page, /showcase.html). Not a product screen.
 * Renders every control in both states with QA's contrast-gate markers (docs/decisions.md, UI
 * conventions) so qa/scripts/check-tokens.mjs Parts A-C can run against it.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="mb-3 text-title">{title}</h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

/** Enlarges the hit area to the 44px/32px target without changing the visual box (PM #16). */
const HIT_AREA =
  "relative before:absolute before:left-1/2 before:top-1/2 before:h-target before:w-target before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  const [on, setOn] = useState(checked);
  const id = useId();
  return (
    <span className="flex min-h-target items-center gap-2 text-body">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-labelledby={id}
        data-ui-state="checkbox"
        onClick={() => {
          setOn(!on);
        }}
        className={
          `${HIT_AREA} flex h-5 w-5 items-center justify-center rounded-input border-2 ` +
          (on ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface')
        }
      >
        <span aria-hidden="true">{on ? '✓' : ''}</span>
      </button>
      <span id={id}>{label}</span>
    </span>
  );
}

function Switch({ checked, label }: { checked: boolean; label: string }) {
  const [on, setOn] = useState(checked);
  const id = useId();
  return (
    <span className="flex min-h-target items-center gap-2 text-body">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        data-ui-state="switch"
        onClick={() => {
          setOn(!on);
        }}
        className={
          `${HIT_AREA} flex h-6 w-10 items-center rounded-full border-2 p-0.5 ` +
          (on
            ? 'justify-end border-primary bg-primary'
            : 'justify-start border-border-strong bg-surface')
        }
      >
        <span
          aria-hidden="true"
          className={'h-4 w-4 rounded-full ' + (on ? 'bg-on-primary' : 'bg-border-strong')}
        />
      </button>
      <span id={id}>{label}</span>
    </span>
  );
}

function Radio({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="flex min-h-target items-center gap-2 text-body">
      <span
        role="radio"
        aria-checked={checked}
        aria-label={label}
        tabIndex={0}
        data-ui-state="radio"
        className={
          `${HIT_AREA} flex h-5 w-5 items-center justify-center rounded-full border-2 ` +
          (checked ? 'border-primary' : 'border-border-strong')
        }
      >
        {checked ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

export function Showcase() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <img src={glyphUrl} alt="" width={32} height={32} data-decorative />
        <h1 className="text-headline">Token showcase</h1>
      </header>
      <p className="text-body-sm text-text-muted">
        QA and Designer review page. Every control is shown in both states.
      </p>

      <Section title="Icons">
        <svg
          role="img"
          aria-label="Stored on this device only"
          data-ui-state="icon"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          className="text-text"
        >
          <rect
            x="5"
            y="11"
            width="14"
            height="10"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="text-body-sm">Stored on this device only</span>
      </Section>

      <Section title="Buttons">
        <button
          type="button"
          className="min-h-target rounded-full bg-primary px-4 text-body-sm font-medium text-on-primary"
        >
          Primary
        </button>
        <button
          type="button"
          className="min-h-target rounded-full border border-border-strong bg-surface px-4 text-body-sm font-medium text-text"
        >
          Secondary
        </button>
        <button
          type="button"
          className="min-h-target rounded-full bg-accent px-4 text-body-sm font-medium text-on-accent"
        >
          On gold
        </button>
        <button
          type="button"
          className="min-h-target rounded-full bg-danger px-4 text-body-sm font-medium text-on-danger"
        >
          Delete
        </button>
      </Section>

      <Section title="Checkbox">
        <Checkbox checked={false} label="Unchecked" />
        <Checkbox checked label="Checked" />
      </Section>

      <Section title="Switch">
        <Switch checked={false} label="Off" />
        <Switch checked label="On" />
      </Section>

      <Section title="Radio">
        <div role="radiogroup" aria-label="Example radios" className="flex gap-4">
          <Radio checked={false} label="Not selected" />
          <Radio checked label="Selected" />
        </div>
      </Section>

      <Section title="Text input">
        <label className="flex flex-col gap-1 text-body-sm">
          Signer name
          <input
            data-ui-state="input"
            className="min-h-target rounded-input border border-border-strong bg-surface px-3 text-body text-text"
            defaultValue="Ada Lovelace"
          />
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          Invalid
          <input
            data-ui-state="input"
            aria-invalid="true"
            className="min-h-target rounded-input border-2 border-danger bg-surface px-3 text-body text-text"
            defaultValue=""
          />
          <span className="text-caption text-danger">Enter a name.</span>
        </label>
      </Section>

      <Section title="List selection">
        <ul role="listbox" aria-label="Example list" className="flex flex-col gap-1">
          <li
            role="option"
            aria-selected="false"
            tabIndex={0}
            data-ui-state="selected"
            className="min-h-target rounded-input border border-border-strong px-3 py-2 text-body"
          >
            Not selected
          </li>
          <li
            role="option"
            aria-selected="true"
            tabIndex={0}
            data-ui-state="selected"
            className="min-h-target rounded-input border-2 border-primary bg-surface-2 px-3 py-2 text-body"
          >
            Selected
          </li>
        </ul>
      </Section>

      <Section title="Status">
        <span className="flex items-center gap-1 rounded-full bg-success-chip-bg px-3 py-1 text-body-sm text-text">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            className="stroke-success"
          >
            <path d="M3 8.5l3 3 7-7" fill="none" strokeWidth="2" />
          </svg>
          Signed
        </span>
        <span className="rounded-full border border-border-strong px-3 py-1 text-body-sm text-text">
          Draft
        </span>
        <span data-decorative className="h-1 w-16 rounded-full bg-accent" />
      </Section>

      <Section title="Selection on the PDF page">
        <div
          className="relative h-48 w-full max-w-sm bg-pdf-page"
          data-qa-backdrop="#FFFFFF"
          aria-label="PDF page preview"
          role="img"
        >
          <p className="absolute left-4 top-4 text-body-sm text-pdf-ink">Page text uses pdf-ink.</p>
          <div className="ds-selection absolute left-12 top-14 h-20 w-40" data-ui-state="selection">
            {(
              [
                '-left-1.5 -top-1.5',
                '-right-1.5 -top-1.5',
                '-bottom-1.5 -left-1.5',
                '-bottom-1.5 -right-1.5',
              ] as const
            ).map((pos) => (
              <span
                key={pos}
                className={`ds-selection-handle absolute ${pos}`}
                data-ui-state="handle"
              />
            ))}
          </div>
        </div>
      </Section>
    </main>
  );
}
