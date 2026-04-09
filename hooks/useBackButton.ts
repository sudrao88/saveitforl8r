/**
 * useBackButton.ts
 *
 * Provides a stack-based back button handler for nested dialogs/overlays.
 * Components register dismiss callbacks via useBackButton(); the most recently
 * registered active handler is invoked first when the Android back button is pressed.
 *
 * App.tsx consults tryBackHandlers() before its own top-level state checks,
 * so nested confirmation dialogs and preview modals dismiss before their
 * parent sheets close.
 */

import { useEffect, useRef } from 'react';
import { isNative } from '../services/platform';

type BackButtonHandler = () => boolean;

const handlers: BackButtonHandler[] = [];

/**
 * Try registered back handlers from most-recently-registered (innermost) first.
 * Returns true if a handler consumed the event.
 */
export function tryBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true;
  }
  return false;
}

/**
 * Register a back button dismiss handler for a nested dialog/overlay.
 *
 * @param onDismiss - Called to close the dialog when back is pressed
 * @param isActive  - Only handles back when true (i.e. when the dialog is open)
 */
export function useBackButton(onDismiss: () => void, isActive: boolean): void {
  const callbackRef = useRef(onDismiss);
  callbackRef.current = onDismiss;

  useEffect(() => {
    if (!isActive || !isNative()) return;

    const handler: BackButtonHandler = () => {
      callbackRef.current();
      return true;
    };

    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  }, [isActive]);
}
