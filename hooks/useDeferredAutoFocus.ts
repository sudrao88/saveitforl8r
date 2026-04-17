import { useEffect } from 'react';

const VIEW_ENTER_DURATION = 400;
const REDUCED_MOTION_DELAY = 10;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useDeferredAutoFocus(
  ref: React.RefObject<HTMLElement | null>,
  options?: { delay?: number; enabled?: boolean },
): void {
  const delay = options?.delay ?? VIEW_ENTER_DURATION;
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const ms = prefersReducedMotion() ? REDUCED_MOTION_DELAY : delay;
    const timer = setTimeout(() => ref.current?.focus(), ms);
    return () => clearTimeout(timer);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
