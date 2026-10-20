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
