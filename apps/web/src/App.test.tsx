import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App, resetBoot } from './App.tsx';
import { fold } from './screens/Library.tsx';
import { parseHash } from './state/route.ts';
import { useApp } from './state/app.ts';
import { useThemeStore } from './state/theme.ts';
import { memoryServices } from './test-services.ts';

beforeEach(() => {
  resetBoot();
  useApp.setState({ status: 'booting', services: undefined, docs: [] });
  location.hash = '';
});
afterEach(() => {
  cleanup();
  act(() => {
    useThemeStore.setState({ preference: 'system' });
  });
});

describe('App shell', () => {
  it('boots to the empty Library with navigation', async () => {
    render(<App factory={memoryServices} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open PDF' })).toBeTruthy();
  });

  it('switches light/dark in Settings and saves the choice', async () => {
    location.hash = '#/settings';
    render(<App factory={memoryServices} />);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const root = document.documentElement;
    expect(root.hasAttribute('data-theme')).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(root.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(root.hasAttribute('data-theme')).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(await useApp.getState().services?.store.getSetting('theme')).toBe('system');
  });
});

describe('helpers', () => {
  it('folds case and accents for search', () => {
    expect(fold('Résumé ÉTÉ')).toBe('resume ete');
  });
  it('parses routes', () => {
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/doc/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toEqual({
      name: 'doc',
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    expect(parseHash('#/nope')).toEqual({ name: 'library' });
  });
});
