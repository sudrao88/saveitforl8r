import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, downloadDataUri } from './downloadService';

describe('downloadBlob', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let createdUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:mock/${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
    // Clean the DOM between runs
    document.body.innerHTML = '';
    // Reset any share mocks
    delete (navigator as unknown as { share?: unknown }).share;
    delete (navigator as unknown as { canShare?: unknown }).canShare;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a hidden anchor, clicks it, and cleans up on non-iOS browsers', async () => {
    // Simulate a desktop Chrome UA
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux x86_64) Chrome/123.0.0.0',
      configurable: true,
    });

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = clickSpy;
        }
        return el;
      });

    const blob = new Blob(['hello'], { type: 'text/plain' });
    await downloadBlob(blob, 'file.txt');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Anchor is inserted then removed from body
    expect(document.body.querySelector('a')).toBeNull();

    // Revoke happens after 1s
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1100);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(createdUrls[0]);

    createElementSpy.mockRestore();
  });

  it('prefers Web Share API on iOS when files are shareable', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    (navigator as unknown as { share: typeof share }).share = share;
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;

    const blob = new Blob(['hi'], { type: 'text/plain' });
    await downloadBlob(blob, 'note.txt');

    expect(canShare).toHaveBeenCalled();
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0];
    expect(arg.title).toBe('note.txt');
    expect(arg.files?.[0].name).toBe('note.txt');
    // Should not have fallen back to the anchor path
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('swallows AbortError from navigator.share without falling back', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    const abort = Object.assign(new Error('user cancelled'), { name: 'AbortError' });
    (navigator as unknown as { share: () => Promise<void> }).share = vi
      .fn()
      .mockRejectedValue(abort);
    (navigator as unknown as { canShare: () => boolean }).canShare = vi
      .fn()
      .mockReturnValue(true);

    const blob = new Blob(['hi'], { type: 'text/plain' });
    await downloadBlob(blob, 'note.txt');

    // Should NOT fall back on user abort
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to blob URL when navigator.share rejects with a non-abort error', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    (navigator as unknown as { share: () => Promise<void> }).share = vi
      .fn()
      .mockRejectedValue(new Error('share failed'));
    (navigator as unknown as { canShare: () => boolean }).canShare = vi
      .fn()
      .mockReturnValue(true);

    const originalCreateElement = document.createElement.bind(document);
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const blob = new Blob(['hi'], { type: 'text/plain' });
    await downloadBlob(blob, 'note.txt');

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('downloadDataUri', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock/0');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
    delete (navigator as unknown as { share?: unknown }).share;
    delete (navigator as unknown as { canShare?: unknown }).canShare;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/123',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the data URI and triggers a blob download', async () => {
    const dataUri = 'data:text/plain;base64,aGVsbG8='; // "hello"
    await downloadDataUri(dataUri, 'greeting.txt');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('re-wraps the blob with the provided MIME type when the fetched type is empty', async () => {
    // Provide a fetch stub returning a blob with empty type so we exercise the re-wrap branch
    const emptyBlob = new Blob(['x']);
    Object.defineProperty(emptyBlob, 'type', { value: '', configurable: true });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(emptyBlob),
    } as unknown as Response);

    await downloadDataUri('data:foo', 'greeting.bin', 'application/octet-stream');

    // The blob passed to createObjectURL should now carry the provided mime type
    const createSpy = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blobArg = createSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/octet-stream');
  });
});
