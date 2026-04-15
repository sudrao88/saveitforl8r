import { useState, useEffect, useRef } from 'react';

export type AnimationPhase = 'enter' | 'exit' | 'idle';

const REDUCED_MOTION_DURATION = 1;
const DEFAULT_DURATION = 250;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hook that delays unmounting to allow exit animations to play.
 *
 * When `isOpen` transitions from true -> false, the hook keeps `mounted` true
 * and sets `phase` to 'exit' for the specified duration, then unmounts.
 *
 * Uses the "setState during render" pattern (React-approved) for synchronous
 * state transitions, and effects only for async timers.
 *
 * @param isOpen  - Whether the component should be visible
 * @param durationMs - Exit animation duration (default 250ms)
 */
export function useAnimatedUnmount(
  isOpen: boolean,
  durationMs: number = DEFAULT_DURATION,
): { mounted: boolean; phase: AnimationPhase } {
  const [mounted, setMounted] = useState(isOpen);
  const [phase, setPhase] = useState<AnimationPhase>(isOpen ? 'enter' : 'idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous isOpen to detect transitions (React-approved pattern).
  // Timer cancellation is handled by the effect cleanup below — no ref
  // access needed during render.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);

    if (isOpen) {
      // false -> true: mount immediately, start enter animation
      setMounted(true);
      setPhase('enter');
    } else {
      // true -> false: start exit animation (unmount via timer in effect)
      setPhase('exit');
    }
  }

  // Timer: transitions enter -> idle and exit -> unmount.
  // The cleanup function cancels any pending timer when phase changes,
  // preventing stale callbacks from firing.
  useEffect(() => {
    const duration = prefersReducedMotion() ? REDUCED_MOTION_DURATION : durationMs;

    if (phase === 'enter') {
      timerRef.current = setTimeout(() => {
        setPhase('idle');
        timerRef.current = null;
      }, duration);
    } else if (phase === 'exit') {
      timerRef.current = setTimeout(() => {
        setMounted(false);
        setPhase('idle');
        timerRef.current = null;
      }, duration);
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, durationMs]);

  return { mounted, phase };
}
