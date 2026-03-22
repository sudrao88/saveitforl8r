import { useEffect, useCallback, useRef } from 'react';
import { isNative } from '../services/platform';

interface WidgetQuickNoteEvent {
  mode?: 'camera';
}

/**
 * Listens for the `onWidgetQuickNote` custom event dispatched by native code
 * when the user taps the home screen widget. Focuses the QuickNoteBar or
 * opens a specific capture mode.
 */
export const useWidgetDeepLink = (
  onQuickNoteFocus: () => void,
  onCameraCapture?: () => void
) => {
  const onQuickNoteFocusRef = useRef(onQuickNoteFocus);
  const onCameraCaptureRef = useRef(onCameraCapture);

  useEffect(() => {
    onQuickNoteFocusRef.current = onQuickNoteFocus;
    onCameraCaptureRef.current = onCameraCapture;
  }, [onQuickNoteFocus, onCameraCapture]);

  const handleWidgetEvent = useCallback((event: Event) => {
    const detail = (event as CustomEvent<WidgetQuickNoteEvent>).detail || {};
    console.log('[Widget] Quick note deep link received:', detail);

    if (detail.mode === 'camera' && onCameraCaptureRef.current) {
      onCameraCaptureRef.current();
    } else {
      onQuickNoteFocusRef.current();
    }
  }, []);

  useEffect(() => {
    if (!isNative()) return;

    window.addEventListener('onWidgetQuickNote', handleWidgetEvent);
    return () => {
      window.removeEventListener('onWidgetQuickNote', handleWidgetEvent);
    };
  }, [handleWidgetEvent]);
};
