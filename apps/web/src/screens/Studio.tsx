/**
 * Signature Studio (SPEC Sec 7.1-7.3, design 04): Draw / Type / Upload / Scan, pen drawer with
 * live preview, saves an encrypted signature. Lazy chunk (SPEC Sec 5 rule 6).
 */
import { Camera, ImageUp, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PEN,
  INK_COLORS,
  LIMITS,
  PRESETS,
  PRESET_IDS,
  clampSettings,
  cleanSignatureImage,
  contrastOnWhite,
  initialsOf,
  inkBounds,
  presetSettings,
  strokesToVector,
  vectorToSvg,
  type PenSettings,
  type Stroke,
  type StrokesPayload,
} from '@dasignature/core';
import { t } from '@dasignature/i18n';
import { uuidv7, type SignatureRecord } from '@dasignature/storage';
import { Checkbox, Segmented, Slider, SwatchGroup, Switch } from '../components/controls.tsx';
import { SignaturePad, paintStrokes } from '../components/SignaturePad.tsx';
import { Button, IconButton, Modal } from '../components/ui.tsx';
import { SCRIPT_FONTS, fontBytes, fontFamily, loadScriptFont } from '../fonts.ts';
import { useApp } from '../state/app.ts';

type Kind = 'signature' | 'initials';
type Tab = 'draw' | 'type' | 'upload' | 'scan';
const PEN_KEY = 'pen.last';

const PREVIEW_STROKE: Stroke = {
  realPressure: false,
  points: Array.from({ length: 60 }, (_, i) => {
    const x = 12 + i * 4;
    return [x, 30 + Math.sin(i / 6) * 14, 0.3 + 0.5 * Math.abs(Math.sin(i / 9)), i * 10];
  }),
};

function PenPreview({ settings }: { settings: PenSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintStrokes(ref.current, [PREVIEW_STROKE], settings, 264, 60);
  }, [settings]);
  return (
    <div
      className="rounded-input border border-border bg-pdf-page"
      style={{ opacity: settings.opacity }}
    >
      <canvas
        ref={ref}
        role="img"
        aria-label={t('studio.preview')}
        data-pen-preview
        className="block h-[60px] w-[264px] max-w-full"
      />
    </div>
  );
}

interface UserPreset {
  id: string;
  name: string;
  settings: PenSettings;
}

function PenDrawer({
  s,
  set,
  color,
  user,
  onSavePreset,
}: {
  s: PenSettings;
  set: (s: PenSettings) => void;
  color: React.ReactNode;
  user: readonly UserPreset[];
  onSavePreset: () => void;
}) {
  const patch = (p: Partial<PenSettings>) => {
    set(clampSettings({ ...s, ...p, preset: 'preset' in p ? (p.preset ?? 'custom') : 'custom' }));
  };
  return (
    <div className="flex flex-col gap-3">
      <PenPreview settings={s} />
      <div role="radiogroup" aria-label={t('studio.presets')} className="flex flex-wrap gap-1">
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            data-ui-state="radio"
            aria-checked={s.preset === id}
            onClick={() => {
              set(presetSettings(id, s));
            }}
            className={`min-h-target rounded-pill border px-3 text-body-sm ${s.preset === id ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface text-text'}`}
          >
            {PRESETS[id].name}
          </button>
        ))}
        {user.map((u) => (
          <button
            key={u.id}
            type="button"
            role="radio"
            data-ui-state="radio"
            aria-checked={false}
            onClick={() => {
              set(clampSettings(u.settings));
            }}
            className="min-h-target rounded-pill border border-border-strong bg-surface px-3 text-body-sm text-text"
          >
            {u.name}
          </button>
        ))}
        <Button variant="ghost" onClick={onSavePreset}>
          {t('studio.savePreset')}
        </Button>
      </div>
      {color}
      <Slider
        label={t('studio.weight')}
        value={s.weight}
        min={LIMITS.weight[0]}
        max={LIMITS.weight[1]}
        step={0.5}
        onChange={(weight) => {
          patch({ weight });
        }}
        format={(v) => `${String(v)} px`}
      />
      <Slider
        label={t('studio.thinness')}
        value={s.thinning}
        min={0}
        max={1}
        step={0.05}
        onChange={(thinning) => {
          patch({ thinning });
        }}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label={t('studio.taper')}
        value={s.taper}
        min={0}
        max={100}
        step={5}
        onChange={(taper) => {
          patch({ taper });
        }}
        format={(v) => `${String(v)}%`}
      />
      <Slider
        label={t('studio.smoothing')}
        value={s.smoothing}
        min={0}
        max={1}
        step={0.05}
        onChange={(smoothing) => {
          patch({ smoothing });
        }}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label={t('studio.opacity')}
        value={Math.round(s.opacity * 100)}
        min={10}
        max={100}
        step={5}
        onChange={(v) => {
          patch({ opacity: v / 100 });
        }}
        format={(v) => `${String(v)}%`}
      />
      {s.preset === 'calligraphy' ? (
        <Slider
          label={t('studio.nibAngle')}
          value={s.nibAngle}
          min={0}
          max={90}
          step={5}
          onChange={(nibAngle) => {
            set(clampSettings({ ...s, nibAngle }));
          }}
          format={(v) => `${String(v)}°`}
        />
      ) : null}
      <Switch
        label={t('studio.pressure')}
        checked={s.pressure}
        onChange={(pressure) => {
          patch({ pressure });
        }}
      />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const custom = !INK_COLORS.some((c) => c.hex === value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm font-medium text-text">{t('studio.color')}</span>
      <SwatchGroup
        label={t('studio.color')}
        value={value}
        options={INK_COLORS}
        onChange={(hex) => {
          if (hex) onChange(hex);
        }}
        extra={
          <label className="flex min-h-target items-center gap-1 text-body-sm text-text">
            <span className="sr-only">{t('studio.customColor')}</span>
            <span
              className={`relative flex h-8 w-8 items-center justify-center rounded-full border border-border-strong ${custom ? 'outline outline-2 outline-offset-2 outline-focus-ring' : ''}`}
              style={custom ? { background: value } : undefined}
            >
              {custom ? null : <Plus aria-hidden size={16} />}
              <input
                type="color"
                value={value}
                aria-label={t('studio.customColor')}
                onChange={(e) => {
                  onChange(e.target.value.toUpperCase());
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </span>
            <input
              aria-label={t('studio.hex')}
              data-ui-state="input"
              value={value}
              maxLength={7}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                if (/^#[0-9A-F]{6}$/.test(v)) onChange(v);
              }}
              className="min-h-target w-24 rounded-input border border-border-strong bg-surface px-2 font-mono text-caption text-text"
            />
          </label>
        }
      />
      {contrastOnWhite(value) < 4.5 ? (
        <p className="text-caption text-text-muted">{t('studio.lowContrast')}</p>
      ) : null}
    </div>
  );
}

interface ImageResult {
  png: Uint8Array;
  url: string;
}

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/** Runs the upload/scan pipeline on a bitmap; returns a trimmed PNG (max 1200 px wide). */
async function processImage(
  bmp: ImageBitmap,
  opts: { removeBackground: boolean; contrast: number; tint: string | null },
): Promise<ImageResult | null> {
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, w, h);
  const cleaned = cleanSignatureImage(
    { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h },
    opts,
  );
  const b = inkBounds(cleaned) ?? { x: 0, y: 0, w, h };
  ctx.putImageData(new ImageData(new Uint8ClampedArray(cleaned.data), w, h), 0, 0);
  const out = document.createElement('canvas');
  const pad = 4;
  out.width = Math.min(1200, b.w + pad * 2);
  out.height = Math.round((out.width / (b.w + pad * 2)) * (b.h + pad * 2));
  out
    .getContext('2d')
    ?.drawImage(c, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((r) => {
    out.toBlob(r, 'image/png');
  });
  c.width = 0;
  out.width = 0;
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
}

function ImagePipeline({
  bmp,
  color,
  onResult,
}: {
  bmp: ImageBitmap;
  color: string;
  onResult: (r: ImageResult | null) => void;
}) {
  const [removeBg, setRemoveBg] = useState(true);
  const [contrast, setContrast] = useState(0);
  const [tint, setTint] = useState<string | null>(color);
  const [result, setResult] = useState<ImageResult | null>(null);
  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      void processImage(bmp, { removeBackground: removeBg, contrast, tint }).then((r) => {
        if (!alive) return;
        setResult((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return r;
        });
        onResult(r);
      });
    }, 60);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [bmp, removeBg, contrast, tint, onResult]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-[200px] items-center justify-center rounded-card border border-border-strong bg-pdf-page p-3">
        {result ? (
          <img
            src={result.url}
            alt=""
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        ) : null}
      </div>
      <Switch label={t('studio.removeBg')} checked={removeBg} onChange={setRemoveBg} />
      <Slider
        label={t('studio.contrast')}
        value={Math.round(contrast * 100)}
        min={-100}
        max={100}
        step={10}
        onChange={(v) => {
          setContrast(v / 100);
        }}
        format={(v) => `${v > 0 ? '+' : ''}${String(v)}`}
      />
      <div className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-text">{t('studio.tint')}</span>
        <SwatchGroup
          label={t('studio.tint')}
          value={tint}
          options={[{ id: 'original', name: t('studio.original'), hex: null }, ...INK_COLORS]}
          onChange={setTint}
        />
      </div>
    </div>
  );
}

function ScanTab({
  color,
  onResult,
  onUseUpload,
}: {
  color: string;
  onResult: (r: ImageResult | null) => void;
  onUseUpload: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [denied, setDenied] = useState(false);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (bmp) return;
    let stream: MediaStream | undefined;
    let alive = true;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((tr) => {
            tr.stop();
          });
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => {
        setDenied(true);
      });
    return () => {
      alive = false;
      stream?.getTracks().forEach((tr) => {
        tr.stop();
      });
    };
  }, [bmp]);
  if (denied)
    return (
      <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface-2 p-4 text-body-sm text-text">
        <p>{t('studio.cameraDenied')}</p>
        <Button onClick={onUseUpload}>{t('studio.useUpload')}</Button>
      </div>
    );
  if (bmp)
    return (
      <div className="flex flex-col gap-2">
        <ImagePipeline bmp={bmp} color={color} onResult={onResult} />
        <Button
          onClick={() => {
            setBmp(null);
            onResult(null);
          }}
        >
          {t('studio.retake')}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full overflow-hidden rounded-card border border-border-strong bg-text">
        <video ref={video} playsInline muted className="block max-h-[320px] w-full object-cover" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[12%] rounded-input border-2 border-dashed border-pdf-page"
        />
      </div>
      <p className="text-caption text-text-muted">{t('studio.scanGuide')}</p>
      <button
        type="button"
        aria-label={t('studio.shutter')}
        onClick={() => {
          const v = video.current;
          if (!v || !v.videoWidth) return;
          void createImageBitmap(v).then(setBmp);
        }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary"
      >
        <Camera aria-hidden size={24} />
      </button>
    </div>
  );
}

export interface StudioProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (rec: SignatureRecord) => void;
  initialKind?: Kind;
  /** "Duplicate and edit": start from this signature's strokes / text. */
  from?: SignatureRecord | undefined;
}

export default function Studio({
  open,
  onClose,
  onSaved,
  initialKind = 'signature',
  from,
}: StudioProps) {
  const services = useApp((s) => s.services);
  const showToast = useApp((s) => s.showToast);
  const [kind, setKind] = useState<Kind>(from?.kind ?? initialKind);
  const [tab, setTab] = useState<Tab>(from?.source === 'type' ? 'type' : 'draw');
  const [initial] = useState(() => {
    if (!from?.strokes_json) return null;
    try {
      return JSON.parse(from.strokes_json) as StrokesPayload;
    } catch {
      return null;
    }
  });
  const [pen, setPenRaw] = useState<PenSettings>(() =>
    initial ? clampSettings(initial.settings) : DEFAULT_PEN,
  );
  const [strokes, setStrokes] = useState<Stroke[]>(() => initial?.strokes ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [signer, setSigner] = useState('');
  const [typed, setTyped] = useState<string | undefined>(from?.typed_text ?? undefined);
  const [font, setFont] = useState(from?.font_id ?? SCRIPT_FONTS[0]?.id ?? 'caveat');
  const [upload, setUpload] = useState<ImageBitmap | null>(null);
  const [image, setImage] = useState<ImageResult | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [name, setName] = useState<string | undefined>();
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [camera, setCamera] = useState(false);
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);

  useEffect(() => {
    const md = navigator.mediaDevices as MediaDevices | undefined;
    void md
      ?.enumerateDevices()
      .then((d) => {
        setCamera(d.some((x) => x.kind === 'videoinput'));
      })
      .catch(() => undefined);
    const store = services?.store;
    if (!store) return;
    void store
      .getSetting(PEN_KEY)
      .then((v) => {
        if (!v || initial) return; // editing keeps the signature's own pen
        try {
          setPenRaw(clampSettings({ ...DEFAULT_PEN, ...(JSON.parse(v) as Partial<PenSettings>) }));
        } catch {
          /* ignore a corrupt value */
        }
      })
      .catch(() => undefined);
    void store
      .select<{ id: string; name: string; settings_json: string }>('pen_presets', 'ORDER BY id')
      .then((rows) => {
        setUserPresets(
          rows.flatMap((r) => {
            try {
              return [
                {
                  id: r.id,
                  name: r.name,
                  settings: clampSettings({
                    ...DEFAULT_PEN,
                    ...(JSON.parse(r.settings_json) as Partial<PenSettings>),
                  }),
                },
              ];
            } catch {
              return [];
            }
          }),
        );
      })
      .catch(() => undefined);
    void store
      .getSetting('signer_name')
      .then((v) => {
        setSigner(v ?? '');
      })
      .catch(() => undefined);
  }, [services, initial]);

  const setPen = useCallback(
    (s: PenSettings) => {
      setPenRaw(s);
      void services?.store.setSetting(PEN_KEY, JSON.stringify(s)).catch(() => undefined);
    },
    [services],
  );

  // SEC-04 / Sec 9: no clipboard of signatures. While the Studio is open, copy and cut do nothing.
  useEffect(() => {
    const block = (e: ClipboardEvent) => {
      e.preventDefault();
    };
    document.addEventListener('copy', block, true);
    document.addEventListener('cut', block, true);
    return () => {
      document.removeEventListener('copy', block, true);
      document.removeEventListener('cut', block, true);
    };
  }, []);

  useEffect(() => {
    if (tab === 'type') for (const f of SCRIPT_FONTS) void loadScriptFont(f).catch(() => undefined);
  }, [tab]);

  const text = typed ?? (kind === 'initials' ? initialsOf(signer) : signer);
  const defaultName = kind === 'initials' ? t('studio.defaultInitials') : t('studio.defaultName');
  const finalName = (name ?? defaultName).trim();
  const hasContent =
    tab === 'draw' ? strokes.length > 0 : tab === 'type' ? text.trim().length > 0 : image !== null;
  const onStroke = useCallback((s: Stroke) => {
    setStrokes((k) => [...k, s]);
    setRedo([]);
  }, []);
  const onImage = useCallback((r: ImageResult | null) => {
    setImage(r);
  }, []);

  const close = () => {
    if (hasContent && !busy) setConfirmDiscard(true);
    else onClose();
  };

  const save = async () => {
    const store = services?.store;
    if (!store || !hasContent || !finalName) return;
    setBusy(true);
    try {
      let rec: SignatureRecord;
      const base = {
        kind,
        name: finalName.slice(0, 60),
        color: pen.color,
        opacity: pen.opacity,
        isDefault,
      };
      if (tab === 'draw') {
        const v = strokesToVector(strokes, pen);
        if (!v) return;
        const payload: StrokesPayload = { v: 1, width: 0, height: 0, strokes, settings: pen };
        rec = await store.addSignature({
          ...base,
          source: 'draw',
          strokes_json: JSON.stringify(payload),
          svg_path: vectorToSvg(v, pen.color, pen.opacity),
          typed_text: null,
          font_id: null,
        });
      } else if (tab === 'type') {
        const f = SCRIPT_FONTS.find((x) => x.id === font) ?? SCRIPT_FONTS[0];
        if (!f) return;
        const { textToVector } = await import('@dasignature/pdf/glyphs');
        const v = textToVector(await fontBytes(f), text.trim());
        if (!v) return;
        rec = await store.addSignature({
          ...base,
          source: 'type',
          strokes_json: null,
          svg_path: vectorToSvg(v, pen.color, pen.opacity),
          typed_text: text.trim(),
          font_id: f.id,
        });
      } else {
        if (!image) return;
        rec = await store.addSignature({
          ...base,
          source: tab === 'scan' ? 'scan' : 'image',
          strokes_json: null,
          svg_path: null,
          typed_text: null,
          font_id: null,
          image: image.png,
        });
      }
      if (!onSaved) showToast({ text: t('studio.saved') });
      onSaved?.(rec);
      onClose();
    } catch (err) {
      console.error(err);
      showToast({ text: t('signatures.saveError'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const tabs = useMemo(
    () => [
      { value: 'draw' as const, label: t('studio.draw') },
      { value: 'type' as const, label: t('studio.type') },
      { value: 'upload' as const, label: t('studio.upload') },
      ...(camera ? [{ value: 'scan' as const, label: t('studio.scan') }] : []),
    ],
    [camera],
  );

  const colorPicker = (
    <ColorPicker
      value={pen.color}
      onChange={(color) => {
        setPen({ ...pen, color });
      }}
    />
  );

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        wide
        title={kind === 'initials' ? t('studio.newInitials') : t('studio.newSignature')}
      >
        <div
          className="flex flex-col gap-4"
          onCopy={(e) => {
            e.preventDefault();
          }}
          onCut={(e) => {
            e.preventDefault();
          }}
        >
          <div className="flex flex-col gap-2 tablet:flex-row">
            <div className="tablet:w-56">
              <Segmented
                label={t('studio.kind')}
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'signature', label: t('studio.signature') },
                  { value: 'initials', label: t('studio.initials') },
                ]}
              />
            </div>
            <div className="flex-1">
              <Segmented label={t('studio.tabs')} value={tab} onChange={setTab} options={tabs} />
            </div>
          </div>

          {tab === 'draw' ? (
            <div className="grid gap-4 desktop:grid-cols-[1fr_280px]">
              <div className="flex flex-col gap-2">
                <div className="flex justify-end gap-1">
                  <IconButton
                    label={t('studio.undo')}
                    disabled={strokes.length === 0}
                    onClick={() => {
                      const last = strokes.at(-1);
                      if (!last) return;
                      setStrokes(strokes.slice(0, -1));
                      setRedo([...redo, last]);
                    }}
                  >
                    <Undo2 aria-hidden size={20} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label={t('studio.redo')}
                    disabled={redo.length === 0}
                    onClick={() => {
                      const r = redo.at(-1);
                      if (!r) return;
                      setRedo(redo.slice(0, -1));
                      setStrokes([...strokes, r]);
                    }}
                  >
                    <Redo2 aria-hidden size={20} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label={t('studio.clear')}
                    disabled={strokes.length === 0}
                    onClick={() => {
                      const prev = strokes;
                      setStrokes([]);
                      setRedo([]);
                      showToast({
                        text: t('studio.cleared'),
                        action: {
                          label: t('app.undo'),
                          run: () => {
                            setStrokes(prev);
                          },
                        },
                      });
                    }}
                  >
                    <Trash2 aria-hidden size={20} strokeWidth={1.75} />
                  </IconButton>
                </div>
                <SignaturePad
                  strokes={strokes}
                  settings={pen}
                  onStroke={onStroke}
                  height={innerWidth >= 1025 ? 300 : innerWidth >= 600 ? 240 : 220}
                  label={
                    strokes.length
                      ? t('studio.padDrawn', { count: String(strokes.length) })
                      : t('studio.padLabel')
                  }
                />
              </div>
              <details
                open={innerHeight > 700}
                className="rounded-card border border-border bg-surface p-3"
              >
                <summary className="min-h-target cursor-pointer text-body-sm font-semibold text-text">
                  {t('studio.penSettings')}
                </summary>
                <PenDrawer
                  s={pen}
                  set={setPen}
                  color={colorPicker}
                  user={userPresets}
                  onSavePreset={() => {
                    const store = services?.store;
                    if (!store) return;
                    const p: UserPreset = {
                      id: uuidv7(),
                      name: `${t('studio.myPreset')} ${String(userPresets.length + 1)}`,
                      settings: pen,
                    };
                    void store
                      .insert('pen_presets', {
                        id: p.id,
                        name: p.name,
                        settings_json: JSON.stringify(p.settings),
                      })
                      .then(() => {
                        setUserPresets([...userPresets, p]);
                        showToast({ text: t('studio.presetSaved') });
                      })
                      .catch(() => undefined);
                  }}
                />
              </details>
            </div>
          ) : null}

          {tab === 'type' ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-body-sm font-medium text-text">
                {kind === 'initials' ? t('studio.typeInitialsLabel') : t('studio.typeLabel')}
                <input
                  data-ui-state="input"
                  value={text}
                  maxLength={60}
                  onChange={(e) => {
                    setTyped(e.target.value);
                  }}
                  className="min-h-target rounded-input border border-border-strong bg-surface px-3 text-body text-text"
                />
              </label>
              <div
                role="radiogroup"
                aria-label={t('studio.fonts')}
                className="grid max-h-[300px] gap-2 overflow-y-auto tablet:grid-cols-2"
              >
                {SCRIPT_FONTS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    data-ui-state="radio"
                    aria-checked={font === f.id}
                    aria-label={f.name}
                    onClick={() => {
                      setFont(f.id);
                    }}
                    className={`flex min-h-[64px] items-center justify-between gap-2 rounded-card border bg-pdf-page px-3 ${font === f.id ? 'border-focus-ring outline outline-2 outline-focus-ring' : 'border-border-strong'}`}
                  >
                    <span
                      className="truncate text-[28px] leading-tight"
                      style={{
                        fontFamily: fontFamily(f.id),
                        color: pen.color,
                        opacity: pen.opacity,
                      }}
                    >
                      {text || f.name}
                    </span>
                    <span className="shrink-0 text-caption text-pdf-ink">{f.name}</span>
                  </button>
                ))}
              </div>
              {colorPicker}
              <Slider
                label={t('studio.opacity')}
                value={Math.round(pen.opacity * 100)}
                min={10}
                max={100}
                step={5}
                onChange={(v) => {
                  setPen({ ...pen, opacity: v / 100 });
                }}
                format={(v) => `${String(v)}%`}
              />
            </div>
          ) : null}

          {tab === 'upload' ? (
            upload ? (
              <div className="flex flex-col gap-2">
                <ImagePipeline bmp={upload} color={pen.color} onResult={onImage} />
                <Button
                  onClick={() => {
                    setUpload(null);
                    setImage(null);
                  }}
                >
                  {t('studio.chooseImage')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-card border-[1.5px] border-dashed border-border-strong bg-surface p-8 text-center">
                <ImageUp aria-hidden size={40} strokeWidth={1.5} className="text-text" />
                <p className="text-body-sm text-text-muted">{t('studio.uploadHint')}</p>
                <label className="inline-flex min-h-target cursor-pointer items-center rounded-input bg-primary px-4 text-body-sm font-medium text-on-primary">
                  {t('studio.chooseImage')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploadError(false);
                      if (f.size > 20 * 1024 * 1024) {
                        setUploadError(true);
                        return;
                      }
                      void decodeImage(f)
                        .then(setUpload)
                        .catch(() => {
                          setUploadError(true);
                        });
                    }}
                  />
                </label>
                {uploadError ? (
                  <p role="alert" className="text-body-sm text-danger">
                    {t('studio.imageError')}
                  </p>
                ) : null}
              </div>
            )
          ) : null}

          {tab === 'scan' ? (
            <ScanTab
              color={pen.color}
              onResult={onImage}
              onUseUpload={() => {
                setTab('upload');
              }}
            />
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-4 tablet:flex-row tablet:items-end">
            <label className="flex flex-1 flex-col gap-1 text-body-sm font-medium text-text">
              {t('studio.name')}
              <input
                data-ui-state="input"
                value={name ?? defaultName}
                maxLength={60}
                aria-invalid={!finalName || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className={`min-h-target rounded-input border bg-surface px-3 text-body text-text ${finalName ? 'border-border-strong' : 'border-danger'}`}
              />
            </label>
            <Checkbox label={t('studio.setDefault')} checked={isDefault} onChange={setIsDefault} />
            <Button
              variant="primary"
              disabled={!hasContent || !finalName || busy}
              busy={busy}
              onClick={() => void save()}
              className="tablet:ml-auto"
            >
              {t('studio.save')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={confirmDiscard}
        onClose={() => {
          setConfirmDiscard(false);
        }}
        title={t('studio.discardTitle')}
      >
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              setConfirmDiscard(false);
            }}
          >
            {t('studio.keepEditing')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDiscard(false);
              onClose();
            }}
          >
            {t('studio.discard')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
