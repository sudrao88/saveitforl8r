import { useState, useEffect, useRef } from 'react';
import { isNative } from '../services/platform';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

// Global CSS variable that mirrors the current keyboard inset in pixels.
// Components apply `padding-bottom: var(--kb-inset, 0px)` (or a max/calc on it)
// so they track the visual viewport in real time without waiting for a React
// re-render. This eliminates the flicker where a bottom bar briefly hides
// behind the keyboard before a transition catches up.
const KB_INSET_VAR = '--kb-inset';

function setKbInsetVar(px: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(KB_INSET_VAR, `${px}px`);
  }
}

export function useKeyboardHeight(options?: {
  includeOffsetTop?: boolean;
  onShow?: () => void;
  onHide?: () => void;
}): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const prevHeightRef = useRef(0);

  useEffect(() => {
    if (isNative()) {
      const platform = Capacitor.getPlatform();

      if (platform === 'android') {
        // Android uses KeyboardResize.Native (adjustResize): the viewport
        // shrinks when the keyboard opens, so sticky/fixed bottom-0 naturally
        // sits above the keyboard. We don't need a JS keyboard height.
        // We still listen for events to fire the onShow callback.
        const showHandle = Keyboard.addListener('keyboardDidShow', () => {
          options?.onShow?.();
        });
        const hideHandle = Keyboard.addListener('keyboardDidHide', () => {
          options?.onHide?.();
        });
        return () => {
          showHandle.then(h => h.remove()).catch(() => {});
          hideHandle.then(h => h.remove()).catch(() => {});
        };
      }

      // iOS: Capacitor keyboard events are reliable in WKWebView
      const showHandle = Keyboard.addListener('keyboardWillShow', (info) => {
        setKeyboardHeight(info.keyboardHeight);
        setKbInsetVar(info.keyboardHeight);
        options?.onShow?.();
      });
      const hideHandle = Keyboard.addListener('keyboardWillHide', () => {
        setKeyboardHeight(0);
        setKbInsetVar(0);
        options?.onHide?.();
      });
      return () => {
        showHandle.then(h => h.remove()).catch(() => {});
        hideHandle.then(h => h.remove()).catch(() => {});
      };
    }

    // PWA/browser: use visualViewport API.
    // Only react to resize/scroll events (not initial measurement) to avoid a
    // false-positive keyboard height during app startup in standalone mode
    // where visualViewport.height may momentarily differ from innerHeight.
    const vv = window.visualViewport;
    if (!vv) return;

    // The global --kb-inset is only driven by the default calculation
    // (offsetTop excluded). Consumers that pass includeOffsetTop use a
    // different formula (vv.offsetTop-adjusted) and should not fight for the
    // same global variable during mount overlaps with other consumers.
    const ownsKbInsetVar = !options?.includeOffsetTop;

    let rafId = 0;
    const update = () => {
      const offset = options?.includeOffsetTop ? vv.offsetTop : 0;
      const kbHeight = window.innerHeight - vv.height - offset;
      const newHeight = kbHeight > 0 ? kbHeight : 0;

      // Update the CSS variable synchronously on every resize event so
      // padding-bottom tracks the viewport continuously as the keyboard
      // animates up/down. No CSS transition is needed on this path.
      if (ownsKbInsetVar) {
        setKbInsetVar(newHeight);
      }

      // React state drives conditional rendering (e.g. sticky vs. fixed
      // positioning) and the onHide callback. Debounce via rAF so we don't
      // re-render on every viewport resize event.
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (prevHeightRef.current > 0 && newHeight === 0) {
          options?.onHide?.();
        }
        prevHeightRef.current = newHeight;
        setKeyboardHeight(newHeight);
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      cancelAnimationFrame(rafId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return keyboardHeight;
}
