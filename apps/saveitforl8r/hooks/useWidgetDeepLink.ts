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

    // Unified handler for both warm launch (event listener) and cold launch
    // (__pendingWidgetEvent). Always clears the window flag to prevent
    // duplicate processing on remount.
    const processWidgetEvent = (event?: Event) => {
      const detail = event
        ? (event as CustomEvent<WidgetQuickNoteEvent>).detail
        : window.__pendingWidgetEvent;

      if (window.__pendingWidgetEvent) {
        delete window.__pendingWidgetEvent;
      }

      if (detail) {
        handleWidgetEvent(new CustomEvent('onWidgetQuickNote', { detail }));
      }
    };

    window.addEventListener('onWidgetQuickNote', processWidgetEvent);

    // Handle events that arrived before the listener was attached (cold launch)
    if (window.__pendingWidgetEvent) {
      processWidgetEvent();
    }

    return () => {
      window.removeEventListener('onWidgetQuickNote', processWidgetEvent);
    };
  }, [handleWidgetEvent]);
};
