import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { isNative } from '../services/platform';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

interface ThemeContextValue {
  /** Raw user preference, including 'system'. */
  theme: ThemePreference;
  /** Effective theme actually applied to the document. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch { /* localStorage unavailable */ }
  return 'system';
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference);
  const [systemLight, setSystemLight] = useState<boolean>(systemPrefersLight);

  // Track OS preference changes so 'system' mode follows live, and listen
  // for `storage` events so theme changes propagate to other open tabs.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const mqHandler = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq?.addEventListener('change', mqHandler);

    const storageHandler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const val = e.newValue;
      if (val === 'light' || val === 'dark' || val === 'system') {
        setThemeState(val);
      } else if (val === null) {
        // Cleared in another tab → fall back to system.
        setThemeState('system');
      }
    };
    window.addEventListener('storage', storageHandler);

    return () => {
      mq?.removeEventListener('change', mqHandler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(
    () => (theme === 'system' ? (systemLight ? 'light' : 'dark') : theme),
    [theme, systemLight]
  );

  // Apply theme to <html> and update the theme-color meta tag whenever it changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolvedTheme === 'light' ? '#ffffff' : '#000000');
  }, [resolvedTheme]);

  // Sync the native status bar to the resolved theme. The status bar style is
  // otherwise set once from capacitor.config (style: DARK = light icons) and
  // never updated, so in light mode the light icons are invisible. Web is a
  // no-op. Style.Dark = light icons (dark bg); Style.Light = dark icons (light
  // bg). setBackgroundColor is Android-only.
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        if (cancelled) return;
        await StatusBar.setStyle({ style: resolvedTheme === 'dark' ? Style.Dark : Style.Light });
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: resolvedTheme === 'dark' ? '#000000' : '#ffffff' });
        }
      } catch { /* StatusBar plugin unavailable — best effort */ }
    })();
    return () => { cancelled = true; };
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      if (next === 'system') {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};
