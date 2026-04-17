import { useState, useEffect, useRef } from 'react';
import { isNative } from '../services/platform';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

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
        options?.onShow?.();
      });
      const hideHandle = Keyboard.addListener('keyboardWillHide', () => {
        setKeyboardHeight(0);
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

    let rafId = 0;
    const update = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const offset = options?.includeOffsetTop ? vv.offsetTop : 0;
        const kbHeight = window.innerHeight - vv.height - offset;
        const newHeight = kbHeight > 0 ? kbHeight : 0;
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
