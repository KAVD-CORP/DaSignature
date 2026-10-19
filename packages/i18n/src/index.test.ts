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
    settings: { clearData: { ...en.settings.clearData, confirmWord: 'LÖSCHEN' } },
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
