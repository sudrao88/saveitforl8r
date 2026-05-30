import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// --- Environment Detection ---
export const isNative = (): boolean => Capacitor.isNativePlatform();

// --- Storage (Preferences for Native, localStorage for Web) ---
export const storage = {
  get: async (key: string): Promise<string | null> => {
    if (isNative()) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(key);
    }
  },
  set: async (key: string, value: string): Promise<void> => {
    if (isNative()) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  },
  remove: async (key: string): Promise<void> => {
    if (isNative()) {
      await Preferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  },
  clear: async (): Promise<void> => {
    if (isNative()) {
      await Preferences.clear();
    } else {
      localStorage.clear();
    }
  }
};

// --- Sharing ---
export const shareContent = async (title: string, text: string, url?: string): Promise<void> => {
  if (isNative()) {
    await Share.share({
      title,
      text,
      url,
      dialogTitle: 'Share to SaveItForL8r',
    });
  } else {
    // Fallback for Web Share API or Clipboard copy
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(`${title} - ${text} ${url || ''}`);
        alert('Copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy to clipboard', err);
      }
    }
  }
};

// --- Haptics ---
export const triggerHaptic = async (style: ImpactStyle = ImpactStyle.Medium): Promise<void> => {
  if (isNative()) {
    await Haptics.impact({ style });
  }
};
