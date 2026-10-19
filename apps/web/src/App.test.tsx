import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { useThemeStore } from './state/theme.ts';

afterEach(() => {
  cleanup();
  act(() => {
    useThemeStore.setState({ preference: 'system' });
  });
});

describe('App shell', () => {
  it('renders the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('DaSignature');
  });

  it('defaults to the system theme and switches light/dark', () => {
    render(<App />);
    const root = document.documentElement;
    expect(root.hasAttribute('data-theme')).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(root.getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(root.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
