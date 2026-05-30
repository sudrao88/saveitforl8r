/**
 * useDismissOrphanKeyboard.ts
 *
 * Android: when the user switches to SaveItForL8R from another app that has
 * the soft keyboard open, the system keeps the IME visible and the viewport
 * shrunk — even though no input inside the WebView is focused. This leaves a
 * blank band where the keyboard would render. Dismiss the orphan keyboard on
 * resume so the app uses the full viewport.
 *
 * Only dismisses when no input/textarea/contenteditable element is focused,
 * so the user's own active editing session is never interrupted.
 */

import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { isNative } from '@l8r/shared/platform';

function isEditableElementFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;

  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const nonKeyboardTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
    return !nonKeyboardTypes.includes(el.type);
  }

  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }

  return el.isContentEditable;
}

export function useDismissOrphanKeyboard(): void {
  useEffect(() => {
    if (!isNative() || Capacitor.getPlatform() !== 'android') return;

    const listenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      if (isEditableElementFocused()) return;
      Keyboard.hide().catch(() => {});
    });

    return () => {
      listenerPromise.then(handle => handle.remove()).catch(() => {});
    };
  }, []);
}
