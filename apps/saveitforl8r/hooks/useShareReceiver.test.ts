import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('@l8r/shared/platform', () => ({
  isNative: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: vi.fn((path: string) => path.replace('file://', 'capacitor://localhost/_capacitor_file_')),
    isNativePlatform: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {},
  Directory: {},
}));

import { useShareReceiver } from './useShareReceiver';
import { isNative } from '@l8r/shared/platform';

const mockIsNative = vi.mocked(isNative);

// --- Helpers ---

function createMockShareEvent(data: { text?: string; attachments?: any[] }) {
  return new CustomEvent('onShareReceived', { detail: data });
}

// --- Tests ---

describe('useShareReceiver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative.mockReturnValue(true);
    delete window.__shareReceiverReady;
    delete window.__pendingShareData;
    // Reset location
    Object.defineProperty(window, 'location', {
      value: { search: '', href: 'http://localhost/' },
      writable: true,
    });
  });

  afterEach(() => {
    delete window.__shareReceiverReady;
    delete window.__pendingShareData;
  });

  describe('native mode', () => {
    it('should set __shareReceiverReady on mount', () => {
      renderHook(() => useShareReceiver());
      expect(window.__shareReceiverReady).toBe(true);
    });

    it('should clear __shareReceiverReady on unmount', () => {
      const { unmount } = renderHook(() => useShareReceiver());
      expect(window.__shareReceiverReady).toBe(true);
      unmount();
      expect(window.__shareReceiverReady).toBe(false);
    });

    it('should handle text-only share event', async () => {
      const { result } = renderHook(() => useShareReceiver());

      await act(async () => {
        window.dispatchEvent(createMockShareEvent({ text: 'Hello world' }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('Hello world');
        expect(result.current.shareData?.attachments).toHaveLength(0);
      });
    });

    it('should handle share with pre-encoded dataUrl attachment (iOS cold start)', async () => {
      const { result } = renderHook(() => useShareReceiver());

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      await act(async () => {
        window.dispatchEvent(createMockShareEvent({
          text: 'Photo share',
          attachments: [{
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            path: '/var/mobile/Containers/Shared/AppGroup/shares/photo.jpg',
            dataUrl,
          }],
        }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('Photo share');
        expect(result.current.shareData?.attachments).toHaveLength(1);
        expect(result.current.shareData?.attachments[0].data).toBe(dataUrl);
        expect(result.current.shareData?.attachments[0].type).toBe('image');
        expect(result.current.shareData?.attachments[0].mimeType).toBe('image/jpeg');
        expect(result.current.shareData?.attachments[0].name).toBe('photo.jpg');
      });
    });

    it('should handle share with pre-encoded PDF attachment', async () => {
      const { result } = renderHook(() => useShareReceiver());

      const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQ=';
      await act(async () => {
        window.dispatchEvent(createMockShareEvent({
          text: '',
          attachments: [{
            name: 'document.pdf',
            mimeType: 'application/pdf',
            path: '/some/path/document.pdf',
            dataUrl,
          }],
        }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.attachments).toHaveLength(1);
        expect(result.current.shareData?.attachments[0].type).toBe('file');
        expect(result.current.shareData?.attachments[0].data).toBe(dataUrl);
      });
    });

    it('should handle multiple attachments with mixed dataUrl and path', async () => {
      const mockBlob = new Blob(['file content'], { type: 'text/plain' });
      const mockResponse = { blob: () => Promise.resolve(mockBlob) };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useShareReceiver());

      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      await act(async () => {
        window.dispatchEvent(createMockShareEvent({
          text: 'Mixed attachments',
          attachments: [
            {
              name: 'image.png',
              mimeType: 'image/png',
              path: '/some/path/image.png',
              dataUrl,
            },
            {
              name: 'file.txt',
              mimeType: 'text/plain',
              path: 'file:///some/path/file.txt',
            },
          ],
        }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.attachments).toHaveLength(2);
        // First attachment uses pre-encoded dataUrl
        expect(result.current.shareData?.attachments[0].data).toBe(dataUrl);
        // Second attachment was fetched from file path
        expect(result.current.shareData?.attachments[1].name).toBe('file.txt');
      });
    });

    it('should consume pending share data on mount (cold start)', async () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ==';
      window.__pendingShareData = {
        text: 'Pending from cold start',
        attachments: [{
          name: 'cold-start-photo.jpg',
          mimeType: 'image/jpeg',
          path: '/expired/path/photo.jpg',
          dataUrl,
        }],
      };

      const { result } = renderHook(() => useShareReceiver());

      // Pending data should be consumed
      expect(window.__pendingShareData).toBeUndefined();

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('Pending from cold start');
        expect(result.current.shareData?.attachments).toHaveLength(1);
        expect(result.current.shareData?.attachments[0].data).toBe(dataUrl);
      });
    });

    it('should handle pending share data with text only (no attachments)', async () => {
      window.__pendingShareData = {
        text: 'Just text from cold start',
      };

      const { result } = renderHook(() => useShareReceiver());

      expect(window.__pendingShareData).toBeUndefined();

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('Just text from cold start');
        expect(result.current.shareData?.attachments).toHaveLength(0);
      });
    });

    it('should skip attachments that fail to process', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('File not found'));

      const { result } = renderHook(() => useShareReceiver());

      await act(async () => {
        window.dispatchEvent(createMockShareEvent({
          text: 'With broken attachment',
          attachments: [{
            name: 'missing.jpg',
            mimeType: 'image/jpeg',
            path: '/expired/file/missing.jpg',
            // No dataUrl — will try to fetch and fail
          }],
        }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('With broken attachment');
        // Attachment should be skipped due to fetch error
        expect(result.current.shareData?.attachments).toHaveLength(0);
      });
    });

    it('should clear share data when clearShareData is called', async () => {
      const { result } = renderHook(() => useShareReceiver());

      await act(async () => {
        window.dispatchEvent(createMockShareEvent({ text: 'To clear' }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
      });

      act(() => {
        result.current.clearShareData();
      });

      expect(result.current.shareData).toBeNull();
    });

    it('should not process empty share events', async () => {
      const { result } = renderHook(() => useShareReceiver());

      await act(async () => {
        window.dispatchEvent(createMockShareEvent({ text: '', attachments: [] }));
      });

      // Give time for any async processing
      await new Promise(r => setTimeout(r, 50));
      expect(result.current.shareData).toBeNull();
    });

    it('should handle share event with only attachments (no text)', async () => {
      const { result } = renderHook(() => useShareReceiver());

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ==';
      await act(async () => {
        window.dispatchEvent(createMockShareEvent({
          attachments: [{
            name: 'image-only.jpg',
            mimeType: 'image/jpeg',
            path: '/some/path',
            dataUrl,
          }],
        }));
      });

      await waitFor(() => {
        expect(result.current.shareData).not.toBeNull();
        expect(result.current.shareData?.text).toBe('');
        expect(result.current.shareData?.attachments).toHaveLength(1);
      });
    });
  });

  describe('web mode', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(false);
    });

    it('should not set __shareReceiverReady in web mode', () => {
      renderHook(() => useShareReceiver());
      expect(window.__shareReceiverReady).toBeUndefined();
    });
  });
});
