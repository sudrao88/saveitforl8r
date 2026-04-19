import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capacitor mocks must be declared before importing platform.ts.
const capacitorIsNative = vi.fn();
const prefsGet = vi.fn();
const prefsSet = vi.fn();
const prefsRemove = vi.fn();
const prefsClear = vi.fn();
const shareShare = vi.fn();
const hapticsImpact = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => capacitorIsNative() },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (opts: { key: string }) => prefsGet(opts),
    set: (opts: { key: string; value: string }) => prefsSet(opts),
    remove: (opts: { key: string }) => prefsRemove(opts),
    clear: () => prefsClear(),
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: (opts: unknown) => shareShare(opts) },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: (opts: unknown) => hapticsImpact(opts) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

// Import after mocks so the module picks up the stubs.
import { isNative, storage, shareContent, triggerHaptic } from './platform';

describe('platform.isNative', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reflects Capacitor.isNativePlatform()', () => {
    capacitorIsNative.mockReturnValueOnce(true);
    expect(isNative()).toBe(true);
    capacitorIsNative.mockReturnValueOnce(false);
    expect(isNative()).toBe(false);
  });
});

describe('platform.storage (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitorIsNative.mockReturnValue(false);
    localStorage.clear();
  });

  it('get/set/remove roundtrips through localStorage', async () => {
    await storage.set('foo', 'bar');
    expect(localStorage.getItem('foo')).toBe('bar');
    expect(await storage.get('foo')).toBe('bar');
    await storage.remove('foo');
    expect(localStorage.getItem('foo')).toBeNull();
    expect(await storage.get('foo')).toBeNull();
  });

  it('overwrites existing values on set', async () => {
    await storage.set('k', 'v1');
    await storage.set('k', 'v2');
    expect(await storage.get('k')).toBe('v2');
  });

  it('returns null for missing keys', async () => {
    expect(await storage.get('missing')).toBeNull();
  });

  it('clear() removes everything from localStorage', async () => {
    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.clear();
    expect(localStorage.length).toBe(0);
  });

  it('does not call Capacitor Preferences in web mode', async () => {
    await storage.set('k', 'v');
    await storage.get('k');
    await storage.remove('k');
    await storage.clear();
    expect(prefsGet).not.toHaveBeenCalled();
    expect(prefsSet).not.toHaveBeenCalled();
    expect(prefsRemove).not.toHaveBeenCalled();
    expect(prefsClear).not.toHaveBeenCalled();
  });
});

describe('platform.storage (native)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitorIsNative.mockReturnValue(true);
    prefsGet.mockResolvedValue({ value: null });
    prefsSet.mockResolvedValue(undefined);
    prefsRemove.mockResolvedValue(undefined);
    prefsClear.mockResolvedValue(undefined);
  });

  it('routes set/get through Capacitor Preferences', async () => {
    prefsGet.mockResolvedValueOnce({ value: 'stored' });
    await storage.set('native-key', 'native-val');
    expect(prefsSet).toHaveBeenCalledWith({ key: 'native-key', value: 'native-val' });
    const v = await storage.get('native-key');
    expect(prefsGet).toHaveBeenCalledWith({ key: 'native-key' });
    expect(v).toBe('stored');
  });

  it('returns null when Preferences has no value', async () => {
    prefsGet.mockResolvedValueOnce({ value: null });
    expect(await storage.get('absent')).toBeNull();
  });

  it('remove() delegates to Preferences.remove', async () => {
    await storage.remove('k');
    expect(prefsRemove).toHaveBeenCalledWith({ key: 'k' });
  });

  it('clear() delegates to Preferences.clear', async () => {
    await storage.clear();
    expect(prefsClear).toHaveBeenCalledTimes(1);
  });

  it('does not touch localStorage in native mode', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    await storage.set('k', 'v');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('platform.shareContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses Capacitor Share when running natively', async () => {
    capacitorIsNative.mockReturnValue(true);
    await shareContent('t', 'text', 'https://x.test');
    expect(shareShare).toHaveBeenCalledWith({
      title: 't',
      text: 'text',
      url: 'https://x.test',
      dialogTitle: 'Share to SaveItForL8r',
    });
  });

  it('uses navigator.share on web when available', async () => {
    capacitorIsNative.mockReturnValue(false);
    const navShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: navShare, configurable: true });
    try {
      await shareContent('t', 'text', 'https://x.test');
      expect(navShare).toHaveBeenCalledWith({ title: 't', text: 'text', url: 'https://x.test' });
      expect(shareShare).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });

  it('falls back to clipboard copy when navigator.share is missing', async () => {
    capacitorIsNative.mockReturnValue(false);
    // Ensure navigator.share is absent.
    delete (navigator as { share?: unknown }).share;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
      await shareContent('Hi', 'hello', 'https://x.test');
      expect(writeText).toHaveBeenCalledWith('Hi - hello https://x.test');
      expect(alertSpy).toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('swallows navigator.share errors', async () => {
    capacitorIsNative.mockReturnValue(false);
    const err = new Error('user aborted');
    const navShare = vi.fn().mockRejectedValue(err);
    Object.defineProperty(navigator, 'share', { value: navShare, configurable: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(shareContent('t', 'text')).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      delete (navigator as { share?: unknown }).share;
    }
  });
});

describe('platform.triggerHaptic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggers haptic feedback on native', async () => {
    capacitorIsNative.mockReturnValue(true);
    await triggerHaptic();
    expect(hapticsImpact).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', async () => {
    capacitorIsNative.mockReturnValue(false);
    await triggerHaptic();
    expect(hapticsImpact).not.toHaveBeenCalled();
  });
});
