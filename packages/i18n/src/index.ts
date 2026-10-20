/**
 * i18n package. English first; ICU formatting, more catalogs and the language switcher land in
 * Milestone 7. M1 sets up the key structure and the locale-aware typed-confirm match (D9).
 */
import { en, type Messages } from './messages/en.ts';
import { ar } from './messages/ar.ts';

export { en, ar, type Messages };

type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>;
};
/** A translation catalog: any subset of the English keys (the rest fall back to English). */
export type PartialMessages = DeepPartial<Messages>;

/** Shipped UI locales, each named in its own language. */
export const LOCALES: readonly { id: string; name: string; messages: PartialMessages }[] = [
  { id: 'en', name: 'English', messages: en },
  { id: 'ar', name: 'العربية', messages: ar },
];

let current: { locale: string; messages: PartialMessages } = { locale: 'en', messages: en };

/** Best shipped locale for a preference ('system' = the browser's languages). */
export function resolveLocale(pref: string, languages: readonly string[] = []): string {
  const want = pref === 'system' ? languages : [pref];
  for (const l of want) {
    const base = l.toLowerCase().split(/[-_]/)[0] ?? '';
    const hit = LOCALES.find((x) => x.id === base);
    if (hit) return hit.id;
  }
  return 'en';
}

/** Switches the active catalog; returns the resolved locale id. */
export function setLocale(locale: string): string {
  const hit = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];
  current = { locale: hit?.id ?? 'en', messages: hit?.messages ?? en };
  return current.locale;
}
export function currentLocale(): string {
  return current.locale;
}
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
  messages: PartialMessages = current.messages,
): string {
  const lookup = (m: PartialMessages): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        m,
      );
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
  messages: PartialMessages = current.messages,
): boolean {
  const collator = new Intl.Collator(locale, { usage: 'search', sensitivity: 'accent' });
  const input = normalize(typed);
  return [
    t('settings.clearData.confirmWord', {}, messages),
    en.settings.clearData.confirmWord,
  ].some((word) => collator.compare(input, normalize(word)) === 0);
}
