import { useEffect } from 'react';

type HotkeyCallback = (event: KeyboardEvent) => void;

export const useHotkeys = (hotkeys: Record<string, HotkeyCallback>) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier) {
        const hotkey = Object.keys(hotkeys).find(hk => {
          const [mod, k] = hk.toLowerCase().split('+');
          return (mod === 'mod' && k === key);
        });

        if (hotkey) {
          event.preventDefault();
          hotkeys[hotkey](event);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hotkeys]);
};
