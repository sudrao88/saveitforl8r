import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { SyncProvider, useSync } from './SyncContext';

// Mock all dependencies
vi.mock('../services/storageService', () => ({
  getMemories: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue(undefined),
  deleteMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/googleDriveService', () => ({
  listAllFiles: vi.fn().mockResolvedValue([]),
  downloadFileContent: vi.fn().mockResolvedValue({}),
  uploadFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
  findFileByName: vi.fn().mockResolvedValue(null),
  isLinked: vi.fn().mockReturnValue(true),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authStatus: 'linked',
    getAccessToken: vi.fn().mockResolvedValue('mock-token'),
    login: vi.fn(),
    unlink: vi.fn(),
  }),
}));

import * as storageService from '../services/storageService';
import * as driveService from '../services/googleDriveService';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SyncProvider>{children}</SyncProvider>
);

describe('SyncContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should provide sync context values', () => {
    const { result } = renderHook(() => useSync(), { wrapper });

    expect(result.current.isSyncing).toBe(false);
    expect(result.current.syncError).toBeNull();
    expect(result.current.sync).toBeInstanceOf(Function);
    expect(result.current.syncFile).toBeInstanceOf(Function);
    expect(result.current.pendingCount).toBe(0);
  });

  it('should throw when used outside SyncProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useSync());
    }).toThrow('useSync must be used within SyncProvider');

    consoleSpy.mockRestore();
  });

  describe('full sync', () => {
    it('should upload local-only memories to Drive', async () => {
      const localMemories = [
        { id: 'local-1', content: 'Test memory', timestamp: 1000, tags: [] },
      ];
      (storageService.getMemories as any).mockResolvedValue(localMemories);
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        // Advance past debounce
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      expect(driveService.uploadFile).toHaveBeenCalledWith(
        'local-1.json',
        expect.objectContaining({ id: 'local-1' })
      );
    });

    it('should download remote-only memories to local', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'remote-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      (driveService.downloadFileContent as any).mockResolvedValue({
        id: 'remote-1',
        content: 'Remote memory',
        timestamp: 2000,
        tags: [],
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      expect(driveService.downloadFileContent).toHaveBeenCalledWith('drive-file-1');
      expect(storageService.saveMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'remote-1' })
      );
    });

    it('should prefer remote version when remote timestamp is newer', async () => {
      const localMem = { id: 'mem-1', content: 'Old local', timestamp: 1000, tags: [] };
      const remoteMem = { id: 'mem-1', content: 'New remote', timestamp: 2000, tags: [] };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      (driveService.downloadFileContent as any).mockResolvedValue(remoteMem);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      expect(storageService.saveMemory).toHaveBeenCalledWith(remoteMem);
    });

    it('should upload local version when local timestamp is newer', async () => {
      const localMem = { id: 'mem-1', content: 'New local', timestamp: 3000, tags: [] };
      const remoteMem = { id: 'mem-1', content: 'Old remote', timestamp: 1000, tags: [] };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      (driveService.downloadFileContent as any).mockResolvedValue(remoteMem);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      expect(driveService.uploadFile).toHaveBeenCalledWith(
        'mem-1.json',
        localMem,
        'drive-file-1'
      );
    });

    it('should handle soft-deleted remote memories', async () => {
      const localMem = { id: 'mem-1', content: 'Old', timestamp: 1000, tags: [] };
      const deletedRemote = { id: 'mem-1', content: '', timestamp: 2000, tags: [], isDeleted: true };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      (driveService.downloadFileContent as any).mockResolvedValue(deletedRemote);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      expect(storageService.deleteMemory).toHaveBeenCalledWith('mem-1');
    });
  });

  describe('single file sync', () => {
    it('should upload a single memory to Drive', async () => {
      const memory = { id: 'single-1', content: 'Test', timestamp: 1000, tags: [] };
      (driveService.findFileByName as any).mockResolvedValue(null);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(memory as any);
      });

      expect(driveService.uploadFile).toHaveBeenCalledWith(
        'single-1.json',
        memory,
        undefined
      );
    });

    it('should skip sample memories', async () => {
      const sampleMem = { id: 'sample-1', content: 'Sample', timestamp: 1000, tags: [], isSample: true };

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(sampleMem as any);
      });

      expect(driveService.uploadFile).not.toHaveBeenCalled();
    });

    it('should skip pending memories', async () => {
      const pendingMem = { id: 'pending-1', content: 'Pending', timestamp: 1000, tags: [], isPending: true };

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(pendingMem as any);
      });

      expect(driveService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('sync error handling', () => {
    it('should set syncError on auth failure', async () => {
      (storageService.getMemories as any).mockRejectedValue(new Error('Unauthorized 401'));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        // Start sync and immediately attach a catch handler to prevent unhandled rejection
        const syncPromise = result.current.sync(true).catch(() => {
          // Expected rejection — error state is set internally by SyncContext
        });
        // Advance past debounce timer
        vi.advanceTimersByTime(2500);
        await syncPromise;
      });

      // syncError should be set (auth-related or generic)
      expect(result.current.syncError).toBeTruthy();
    });

    it('should not sync when not linked', async () => {
      (driveService.isLinked as any).mockReturnValue(false);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.sync();
      });

      // No Drive operations should have been called
      expect(driveService.listAllFiles).not.toHaveBeenCalled();
    });
  });
});
