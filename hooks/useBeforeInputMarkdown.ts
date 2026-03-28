import { useEffect, type RefObject } from 'react';
import { handleEditorBeforeInput } from '../utils/editorUtils';

/**
 * Attach a native `beforeinput` listener for markdown auto-formatting.
 *
 * Android virtual keyboards fire keydown with e.key === 'Unidentified',
 * so the keydown handler can't detect space presses. beforeinput reliably
 * provides the inserted character via event.data.
 */
const useBeforeInputMarkdown = (
  editorRef: RefObject<HTMLElement | null>,
  checkFormats: () => void
) => {
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      handleEditorBeforeInput(e as InputEvent, el, checkFormats);
    };
    el.addEventListener('beforeinput', handler);
    return () => el.removeEventListener('beforeinput', handler);
  }, [checkFormats]);
};

export default useBeforeInputMarkdown;
