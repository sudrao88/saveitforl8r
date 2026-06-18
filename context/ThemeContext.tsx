import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from 'react';

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

    // Native (Capacitor Android): keep the system status/navigation bar icon
    // color in sync with the resolved theme. No-op on web or on older APKs
    // whose bridge predates setStatusBarStyle.
    try {
      window.AndroidBridge?.setStatusBarStyle?.(resolvedTheme === 'dark');
    } catch { /* bridge unavailable */ }
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
