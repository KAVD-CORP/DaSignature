/** Form controls per components.md: segmented, slider, switch, checkbox, swatches. */
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-input border border-border bg-surface-2 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-ui-state="radio"
          aria-checked={value === o.value}
          onClick={() => {
            onChange(o.value);
          }}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = options[(i + d + options.length) % options.length];
            if (next) onChange(next.value);
          }}
          className={`min-h-target flex-1 rounded-[6px] px-3 text-body-sm font-medium text-text ${value === o.value ? 'border border-border-strong bg-surface' : 'border border-transparent'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-body-sm">
        <label htmlFor={id} className="font-medium text-text">
          {label}
        </label>
        <span className="tabular-nums text-text">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="min-h-target w-full accent-[var(--primary)]"
      />
    </div>
  );
}

export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex min-h-touch cursor-pointer items-center justify-between gap-3 text-body-sm font-medium text-text">
        {label}
        <button
          type="button"
          role="switch"
          data-ui-state="switch"
          aria-checked={checked}
          aria-label={label}
          aria-describedby={description ? id : undefined}
          onClick={() => {
            onChange(!checked);
          }}
          className={`relative h-[26px] w-[44px] shrink-0 rounded-pill border transition-colors duration-fast ${checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-2'}`}
        >
          <span
            aria-hidden
            className={`absolute top-[3px] h-[18px] w-[18px] rounded-full transition-[left] duration-fast ${checked ? 'left-[21px] bg-on-primary' : 'left-[3px] bg-text-muted'}`}
          />
        </button>
      </label>
      {description ? (
        <p id={id} className="text-caption text-text-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-target cursor-pointer items-center gap-2 text-body-sm text-text">
      <button
        type="button"
        role="checkbox"
        data-ui-state="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={() => {
          onChange(!checked);
        }}
        className={`flex h-5 w-5 items-center justify-center rounded-[4px] border-[1.5px] ${checked ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface'}`}
      >
        {checked ? <Check aria-hidden size={14} strokeWidth={2.5} /> : null}
      </button>
      {label}
    </label>
  );
}

export function SwatchGroup({
  label,
  value,
  options,
  onChange,
  extra,
}: {
  label: string;
  value: string | null;
  options: readonly { id: string; name: string; hex: string | null }[];
  onChange: (hex: string | null) => void;
  extra?: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.hex}
          aria-label={o.name}
          data-ui-state="radio"
          onClick={() => {
            onChange(o.hex);
          }}
          className="flex min-h-target min-w-target items-center justify-center rounded-full"
        >
          <span
            className={`block h-8 w-8 rounded-full border border-border ${value === o.hex ? 'outline outline-2 outline-offset-2 outline-focus-ring' : ''}`}
            style={o.hex ? { background: o.hex } : { background: 'var(--pdf-page)' }}
          />
        </button>
      ))}
      {extra}
    </div>
  );
}
