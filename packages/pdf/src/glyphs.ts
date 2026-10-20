/**
 * Typed signatures to vector outlines (SPEC Sec 7.3: "glyphs to outlines on export"). The outline
 * is computed once when the signature is saved and stored as the same path format as drawn
 * signatures, so export never needs the font. Lazy: only the Studio imports this.
 */
import fontkit from '@pdf-lib/fontkit';

export interface GlyphVector {
  d: string;
  width: number;
  height: number;
}

interface PathCommand {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  args: number[];
}
interface FontLike {
  unitsPerEm: number;
  ascent: number;
  layout: (text: string) => {
    glyphs: { path: { commands: PathCommand[] } }[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  };
}

const LETTER: Record<PathCommand['command'], string> = {
  moveTo: 'M',
  lineTo: 'L',
  quadraticCurveTo: 'Q',
  bezierCurveTo: 'C',
  closePath: 'Z',
};

const r = (n: number) => Math.round(n * 100) / 100;

/** Lays out `text` in `fontBytes` at `size` px per em; returns a cropped path (y down). */
export function textToVector(
  fontBytes: Uint8Array,
  text: string,
  size = 96,
  pad = 4,
): GlyphVector | null {
  const font = (fontkit.create as unknown as (b: Uint8Array) => FontLike)(fontBytes);
  const s = size / font.unitsPerEm;
  const run = font.layout(text);
  const cmds: { c: string; pts: [number, number][] }[] = [];
  let pen = 0;
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i] ?? { xAdvance: 0, xOffset: 0, yOffset: 0 };
    for (const c of g.path.commands) {
      const pts: [number, number][] = [];
      for (let k = 0; k + 1 < c.args.length; k += 2)
        pts.push([
          (pen + pos.xOffset + (c.args[k] ?? 0)) * s,
          (font.ascent - pos.yOffset - (c.args[k + 1] ?? 0)) * s,
        ]);
      cmds.push({ c: LETTER[c.command], pts });
    }
    pen += pos.xAdvance;
  });
  const all = cmds.flatMap((c) => c.pts);
  if (all.length === 0) return null;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const ox = Math.min(...xs) - pad;
  const oy = Math.min(...ys) - pad;
  const d = cmds
    .map(
      ({ c, pts }) =>
        c + pts.map(([x, y]) => `${String(r(x - ox))},${String(r(y - oy))}`).join(' '),
    )
    .join('');
  return { d, width: r(Math.max(...xs) - ox + pad), height: r(Math.max(...ys) - oy + pad) };
}

interface LineFont extends FontLike {
  descent: number;
  hasGlyphForCodePoint: (cp: number) => boolean;
}

const fontCache = new WeakMap<Uint8Array, LineFont>();
function open(bytes: Uint8Array): LineFont {
  let f = fontCache.get(bytes);
  if (!f) {
    f = (fontkit.create as unknown as (b: Uint8Array) => LineFont)(bytes);
    fontCache.set(bytes, f);
  }
  return f;
}

/**
 * One line of text as a path in a field box `hPt` tall (y down, points), laid out the way the
 * editor's CSS does: glyph size `ratio` × h, left padding `padRatio` × h, baseline from the first
 * font's ascent/descent centred in the line box. Characters missing from the first font fall back
 * to the next font that has them.
 */
export function textLine(
  fonts: readonly Uint8Array[],
  text: string,
  hPt: number,
  ratio = 0.75,
  padRatio = 0.15,
): { d: string; width: number } {
  const opened = fonts.map(open);
  const main = opened[0];
  if (!main) return { d: '', width: 0 };
  const fs = hPt * ratio;
  const k0 = fs / main.unitsPerEm;
  const content = (main.ascent - main.descent) * k0;
  const baseline = (hPt - content) / 2 + main.ascent * k0;
  // Runs of characters by covering font.
  const runs: { font: LineFont; text: string }[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const font = opened.find((f) => f.hasGlyphForCodePoint(cp)) ?? main;
    const last = runs[runs.length - 1];
    if (last?.font === font) last.text += ch;
    else runs.push({ font, text: ch });
  }
  let pen = hPt * padRatio;
  let d = '';
  for (const { font, text: part } of runs) {
    const k = fs / font.unitsPerEm;
    const run = font.layout(part);
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i] ?? { xAdvance: 0, xOffset: 0, yOffset: 0 };
      for (const c of g.path.commands) {
        d += LETTER[c.command];
        const pts: string[] = [];
        for (let j = 0; j + 1 < c.args.length; j += 2)
          pts.push(
            `${String(r(pen + (pos.xOffset + (c.args[j] ?? 0)) * k))},${String(
              r(baseline - (pos.yOffset + (c.args[j + 1] ?? 0)) * k),
            )}`,
          );
        d += pts.join(' ');
      }
      pen += pos.xAdvance * k;
    });
  }
  return { d, width: r(pen + hPt * padRatio) };
}
