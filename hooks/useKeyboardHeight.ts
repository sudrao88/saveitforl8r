import { useState, useEffect } from 'react';
import { isNative } from '../services/platform';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

/**
 * Track virtual keyboard height across native and PWA.
 * Native: uses Capacitor Keyboard plugin events (visualViewport is unreliable in native webviews).
 * PWA/browser: falls back to the visualViewport API, skipping the initial measurement to avoid
 * false-positive keyboard height during app startup in standalone mode.
 *
 * @param options.includeOffsetTop - Include vv.offsetTop in PWA calculation (for iOS Safari address bar)
 * @param options.onShow - Callback when keyboard appears (native only)
 */
export function useKeyboardHeight(options?: {
  includeOffsetTop?: boolean;
  onShow?: () => void;
}): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (isNative()) {
      const isAndroid = Capacitor.getPlatform() === 'android';
      const showHandle = Keyboard.addListener('keyboardWillShow', (info) => {
        // On Android, Capacitor reports keyboardHeight in physical pixels
        // rather than CSS/dp pixels. Divide by devicePixelRatio to get the
        // correct CSS pixel value for use in style.bottom.
        const height = isAndroid
          ? Math.round(info.keyboardHeight / window.devicePixelRatio)
          : info.keyboardHeight;
        setKeyboardHeight(height);
        options?.onShow?.();
      });
      const hideHandle = Keyboard.addListener('keyboardWillHide', () => {
        setKeyboardHeight(0);
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

    let rafId = 0;
    const update = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const offset = options?.includeOffsetTop ? vv.offsetTop : 0;
        const kbHeight = window.innerHeight - vv.height - offset;
        setKeyboardHeight(kbHeight > 0 ? kbHeight : 0);
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
