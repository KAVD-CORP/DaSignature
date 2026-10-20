/**
 * Bundled script fonts for typed signatures (SPEC Sec 7.3). Latin subsets, weight 400, served
 * same-origin as hashed assets; licences in THIRD_PARTY_NOTICES (OFL-1.1, two Apache-2.0).
 */
import alexBrush from '@fontsource/alex-brush/files/alex-brush-latin-400-normal.woff2?url';
import allura from '@fontsource/allura/files/allura-latin-400-normal.woff2?url';
import caveat from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url';
import dancing from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff2?url';
import greatVibes from '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url';
import homemadeApple from '@fontsource/homemade-apple/files/homemade-apple-latin-400-normal.woff2?url';
import mrDafoe from '@fontsource/mr-dafoe/files/mr-dafoe-latin-400-normal.woff2?url';
import pinyon from '@fontsource/pinyon-script/files/pinyon-script-latin-400-normal.woff2?url';
import sacramento from '@fontsource/sacramento/files/sacramento-latin-400-normal.woff2?url';
import satisfy from '@fontsource/satisfy/files/satisfy-latin-400-normal.woff2?url';

export interface ScriptFont {
  id: string;
  name: string;
  url: string;
}

export const SCRIPT_FONTS: readonly ScriptFont[] = [
  { id: 'caveat', name: 'Caveat', url: caveat },
  { id: 'dancing-script', name: 'Dancing Script', url: dancing },
  { id: 'mr-dafoe', name: 'Mr Dafoe', url: mrDafoe },
  { id: 'homemade-apple', name: 'Homemade Apple', url: homemadeApple },
  { id: 'sacramento', name: 'Sacramento', url: sacramento },
  { id: 'great-vibes', name: 'Great Vibes', url: greatVibes },
  { id: 'allura', name: 'Allura', url: allura },
  { id: 'satisfy', name: 'Satisfy', url: satisfy },
  { id: 'pinyon-script', name: 'Pinyon Script', url: pinyon },
  { id: 'alex-brush', name: 'Alex Brush', url: alexBrush },
];

export const fontFamily = (id: string) => `dasig-${id}`;

const loaded = new Map<string, Promise<void>>();
/** Registers the font with the document (for live previews). */
export function loadScriptFont(f: ScriptFont): Promise<void> {
  let p = loaded.get(f.id);
  if (!p) {
    const face = new FontFace(fontFamily(f.id), `url(${f.url})`);
    p = face.load().then((ff) => {
      document.fonts.add(ff);
    });
    loaded.set(f.id, p);
  }
  return p;
}

export async function fontBytes(f: ScriptFont): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(f.url)).arrayBuffer());
}
