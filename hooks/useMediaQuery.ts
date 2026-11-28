import { useCallback, useSyncExternalStore } from 'react';

/** Matches Tailwind's `lg` breakpoint: layouts with room for a side panel. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** Live result of a CSS media query. False where matchMedia is unavailable. */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  const getSnapshot = useCallback(
    () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
