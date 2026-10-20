import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, en, getDirection, matchesConfirmWord, t, type Messages } from './index.ts';

describe('@dasignature/i18n', () => {
  it('defaults to English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
  it('detects RTL locales', () => {
    expect(getDirection('ar-EG')).toBe('rtl');
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('en-US')).toBe('ltr');
    expect(getDirection('fr_FR')).toBe('ltr');
  });
  it('looks up namespaced keys and fills placeholders', () => {
    const word = t('settings.clearData.confirmWord');
    expect(word).toBe('DELETE');
    expect(t('settings.clearData.confirmLabel', { confirmWord: word })).toBe(
      'Type DELETE to confirm',
    );
  });
});

describe('matchesConfirmWord (D9)', () => {
  const de: Messages = {
    ...en,
    settings: { ...en.settings, clearData: { ...en.settings.clearData, confirmWord: 'LÖSCHEN' } },
  };
  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesConfirmWord('delete', 'en')).toBe(true);
    expect(matchesConfirmWord('  Delete ', 'en')).toBe(true);
    expect(matchesConfirmWord('delet', 'en')).toBe(false);
  });
  it('matches the localized word, accent-sensitively, and always accepts English', () => {
    expect(matchesConfirmWord('löschen', 'de', de)).toBe(true);
    expect(matchesConfirmWord('loschen', 'de', de)).toBe(false);
    expect(matchesConfirmWord('DELETE', 'de', de)).toBe(true);
  });
});

describe('storage messages (PM #69)', () => {
  it('has the update-required copy that storage errors map to', () => {
    expect(t('storage.updateRequired.database')).toMatch(/Update DaSignature/);
    expect(t('storage.updateRequired.backup')).toMatch(/Update DaSignature/);
  });
});

describe('locales', () => {
  it('switches catalogs with English fallback and resolves system languages', async () => {
    const i18n = await import('./index.ts');
    expect(i18n.resolveLocale('system', ['ar-EG', 'en'])).toBe('ar');
    expect(i18n.resolveLocale('system', ['de-DE'])).toBe('en');
    i18n.setLocale('ar');
    expect(i18n.t('nav.library')).toBe('المكتبة');
    expect(i18n.t('library.openPdf')).toBe('فتح ملف PDF');
    expect(i18n.t('viewer.goToPage')).toBe('Go to page'); // fallback
    expect(i18n.matchesConfirmWord('حذف', 'ar')).toBe(true);
    expect(i18n.matchesConfirmWord('delete', 'ar')).toBe(true);
    i18n.setLocale('en');
    expect(i18n.t('nav.library')).toBe('Library');
  });
});
