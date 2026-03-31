import { useEffect, useCallback, useRef } from 'react';
import { isNative } from '../services/platform';

export type WidgetCaptureMode = 'camera' | 'document';

interface WidgetQuickNoteEvent {
  mode?: WidgetCaptureMode;
}

interface WidgetDeepLinkHandlers {
  /** Default: focus the QuickNoteBar text editor */
  onFocus: () => void;
  /** Camera button: open camera capture */
  onCamera?: () => void;
  /** Document button: open document file picker */
  onDocument?: () => void;
}

/**
 * Listens for the `onWidgetQuickNote` custom event dispatched by native code
 * when the user taps the home screen widget. Routes to the appropriate handler
 * based on the capture mode.
 */
export const useWidgetDeepLink = (handlers: WidgetDeepLinkHandlers) => {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleWidgetEvent = useCallback((event: Event) => {
    const detail = (event as CustomEvent<WidgetQuickNoteEvent>).detail || {};
    console.log('[Widget] Quick note deep link received:', detail);

    switch (detail.mode) {
      case 'camera':
        if (handlersRef.current.onCamera) {
          handlersRef.current.onCamera();
        } else {
          handlersRef.current.onFocus();
        }
        break;
      case 'document':
        if (handlersRef.current.onDocument) {
          handlersRef.current.onDocument();
        } else {
          handlersRef.current.onFocus();
        }
        break;
      default:
        handlersRef.current.onFocus();
    }
  }, []);

  useEffect(() => {
    if (!isNative()) return;

    window.addEventListener('onWidgetQuickNote', handleWidgetEvent);

    // Check for a pending widget event that arrived before this hook mounted
    // (e.g., cold launch from widget). Consume and clear it.
    if (window.__pendingWidgetEvent) {
      const pending = window.__pendingWidgetEvent;
      delete window.__pendingWidgetEvent;
      handleWidgetEvent(new CustomEvent('onWidgetQuickNote', { detail: pending }));
    }

    return () => {
      window.removeEventListener('onWidgetQuickNote', handleWidgetEvent);
    };
  }, [handleWidgetEvent]);
};
