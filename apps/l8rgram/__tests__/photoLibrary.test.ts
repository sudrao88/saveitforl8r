import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the native plugin so the module loads in jsdom (the real package's
// native bindings throw on import in a non-Capacitor environment).
vi.mock('@capgo/capacitor-photo-library', () => ({
  PhotoLibrary: {
    checkAuthorization: vi.fn(),
    requestAuthorization: vi.fn(),
    getLibrary: vi.fn(),
    getThumbnailUrl: vi.fn(),
    getPhotoUrl: vi.fn(),
  },
}));

vi.mock('@l8r/shared/platform', () => ({
  isNative: () => false,
  storage: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));

vi.mock('exifr', () => ({
  default: { parse: vi.fn() },
}));

import exifr from 'exifr';
import { resolveCaptureTime } from '../services/photoLibrary';

const exifMock = vi.mocked(exifr.parse);

beforeEach(() => {
  exifMock.mockReset();
});

describe('resolveCaptureTime — EXIF fallback ladder', () => {
  it('prefers EXIF DateTimeOriginal when bytes are provided', async () => {
    const exifDate = new Date('2024-06-15T10:30:00Z');
    exifMock.mockResolvedValueOnce({ DateTimeOriginal: exifDate });

    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const asset = {
      creationDate: '2025-01-01T00:00:00Z',
      modificationDate: '2025-01-02T00:00:00Z',
    } as never;

    const ms = await resolveCaptureTime(asset, blob);
    expect(ms).toBe(exifDate.getTime());
  });

  it('falls back to native creationDate when EXIF unavailable', async () => {
    exifMock.mockResolvedValueOnce({});

    const creationDate = '2024-03-12T09:00:00Z';
    const asset = { creationDate, modificationDate: null } as never;

    const ms = await resolveCaptureTime(asset, new Blob());
    expect(ms).toBe(Date.parse(creationDate));
  });

  it('falls back to file.lastModified when EXIF fails and there is no creationDate', async () => {
    exifMock.mockRejectedValueOnce(new Error('no EXIF'));

    const file = new File(['x'], 'photo.jpg', { lastModified: 1700000000000 });
    const ms = await resolveCaptureTime(null, file);

    expect(ms).toBe(1700000000000);
  });

  it('falls back to native modificationDate as the last tier before Date.now()', async () => {
    exifMock.mockResolvedValueOnce({});

    const modDate = '2023-12-01T00:00:00Z';
    const asset = { creationDate: null, modificationDate: modDate } as never;

    const ms = await resolveCaptureTime(asset, new Blob());
    expect(ms).toBe(Date.parse(modDate));
  });

  it('returns Date.now() when no source is provided and asset has no dates', async () => {
    const before = Date.now();
    const asset = { creationDate: null, modificationDate: null } as never;
    const ms = await resolveCaptureTime(asset);
    const after = Date.now();

    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});
