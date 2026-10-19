/**
 * i18n package. English first; ICU formatting, more catalogs and the language switcher land in
 * Milestone 7. M1 sets up the key structure and the locale-aware typed-confirm match (D9).
 */
import { en, type Messages } from './messages/en.ts';

export { en, type Messages };
export const DEFAULT_LOCALE = 'en';

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'yi', 'dv', 'ckb', 'sd', 'ug']);

/** Text direction for a BCP 47 locale tag. */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  const language = locale.toLocaleLowerCase('en-US').split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

/** Dot-separated paths to every string in the catalog, e.g. 'settings.clearData.confirmWord'. */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Paths<Messages>;

/** Look up a message and fill `{name}` placeholders. Unknown keys fall back to English. */
export function t(
  key: MessageKey,
  params: Readonly<Record<string, string>> = {},
  messages: Messages = en,
): string {
  const lookup = (m: Messages): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], m);
  const found = lookup(messages);
  const text = typeof found === 'string' ? found : String(lookup(en));
  return text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

const normalize = (s: string) => s.normalize('NFKC').trim();

/**
 * Typed-confirm match for "Clear all data" (D9, design/screens/copy/clear-data-confirm.md):
 * locale-aware, case-insensitive and accent-sensitive via Intl.Collator. The English "DELETE"
 * is always accepted too, for keyboards that can't type the localized word.
 */
export function matchesConfirmWord(
  typed: string,
  locale: string,
  messages: Messages = en,
): boolean {
  const collator = new Intl.Collator(locale, { usage: 'search', sensitivity: 'accent' });
  const input = normalize(typed);
  return [
    t('settings.clearData.confirmWord', {}, messages),
    en.settings.clearData.confirmWord,
  ].some((word) => collator.compare(input, normalize(word)) === 0);
}
