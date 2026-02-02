import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { SyncProvider, useSync } from './SyncContext';

// Mock all dependencies
vi.mock('../services/storageService', () => ({
  getMemories: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue(undefined),
  deleteMemory: vi.fn().mockResolvedValue(undefined),
  reconcileEmbeddings: vi.fn().mockResolvedValue({ total: 0, enriched: 0, toQueue: 0, alreadyIndexed: 0, pendingInQueue: 0, error: null, timestamp: Date.now() }),
}));

vi.mock('../services/googleDriveService', () => ({
  listAllFiles: vi.fn().mockResolvedValue([]),
  downloadFileContent: vi.fn().mockResolvedValue({}),
  downloadMultipleFiles: vi.fn().mockResolvedValue({ contents: new Map(), failures: [] }),
  uploadFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
  uploadMultipleFiles: vi.fn().mockResolvedValue({ failures: [] }),
  findFileByName: vi.fn().mockResolvedValue(null),
  deleteFileById: vi.fn().mockResolvedValue(undefined),
  isLinked: vi.fn().mockReturnValue(true),
  deleteRemoteNote: vi.fn().mockResolvedValue(undefined),
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

      // Local-only note should be batch-uploaded via uploadMultipleFiles
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith([
        expect.objectContaining({
          filename: 'local-1.json',
          content: expect.objectContaining({ id: 'local-1' }),
        }),
      ]);
    });

    it('should download remote-only memories to local', async () => {
      const remoteContent = {
        id: 'remote-1',
        content: 'Remote memory',
        timestamp: 2000,
        tags: [],
      };

      (storageService.getMemories as any).mockResolvedValue([]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'remote-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      // downloadMultipleFiles returns a Map of fileId → content
      const contentsMap = new Map([['drive-file-1', remoteContent]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
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

      expect(driveService.downloadMultipleFiles).toHaveBeenCalledWith(['drive-file-1']);
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
      const contentsMap = new Map([['drive-file-1', remoteMem]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
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

      expect(storageService.saveMemory).toHaveBeenCalledWith(remoteMem);
    });

    it('should upload local version when local timestamp is newer', async () => {
      const localMem = { id: 'mem-1', content: 'New local', timestamp: 3000, tags: [] };
      const remoteMem = { id: 'mem-1', content: 'Old remote', timestamp: 1000, tags: [] };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      const contentsMap = new Map([['drive-file-1', remoteMem]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
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

      // Local is newer → should be batch-uploaded with the Drive file ID for PATCH
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'mem-1.json',
            content: localMem,
            existingFileId: 'drive-file-1',
          }),
        ])
      );
    });

    it('should handle soft-deleted remote memories', async () => {
      const localMem = { id: 'mem-1', content: 'Old', timestamp: 1000, tags: [] };
      const deletedRemote = { id: 'mem-1', content: '', timestamp: 2000, tags: [], isDeleted: true };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      const contentsMap = new Map([['drive-file-1', deletedRemote]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
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

      expect(storageService.deleteMemory).toHaveBeenCalledWith('mem-1');
    });

    it('should skip unchanged files when snapshot matches remote modifiedTime', async () => {
      // Set up a snapshot where mem-1 has same modifiedTime as remote
      const snapshot = { 'mem-1': '2024-01-01T00:00:00Z' };
      localStorage.setItem('gdrive_remote_snapshot', JSON.stringify(snapshot));
      localStorage.setItem('gdrive_last_sync_time', '5000'); // Last sync at t=5000

      const localMem = { id: 'mem-1', content: 'Unchanged', timestamp: 1000, tags: [] };
      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      // Should NOT download since snapshot matches → no network call for content
      expect(driveService.downloadMultipleFiles).toHaveBeenCalledWith([]);
      // Should NOT upload since local timestamp (1000) < lastSyncTime (5000)
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith([]);
    });

    it('should delete local note when remote was deleted by another device', async () => {
      // Snapshot says mem-1 existed remotely
      const snapshot = { 'mem-1': '2024-01-01T00:00:00Z' };
      localStorage.setItem('gdrive_remote_snapshot', JSON.stringify(snapshot));
      localStorage.setItem('gdrive_last_sync_time', '5000');

      const localMem = { id: 'mem-1', content: 'Still here locally', timestamp: 1000, tags: [] };
      (storageService.getMemories as any).mockResolvedValue([localMem]);
      // Remote listing is empty — the file was deleted from Drive
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      // Local copy should be deleted because another device removed it from Drive
      expect(storageService.deleteMemory).toHaveBeenCalledWith('mem-1');
    });

    it('should handle local tombstones by deleting remote and hard-deleting local', async () => {
      const tombstone = { id: 'del-1', content: '', timestamp: 2000, tags: [], isDeleted: true };
      (storageService.getMemories as any).mockResolvedValue([tombstone]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-del', name: 'del-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      let syncPromise: Promise<void>;
      await act(async () => {
        syncPromise = result.current.sync(true);
        vi.advanceTimersByTime(2500);
      });

      await act(async () => {
        await syncPromise!;
      });

      // Should delete the remote file by Drive file ID
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-file-del');
      // Should hard-delete the local tombstone
      expect(storageService.deleteMemory).toHaveBeenCalledWith('del-1');
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

    it('should delete remote file and local tombstone on single sync of deleted memory', async () => {
      const tombstone = { id: 'del-single', content: '', timestamp: 2000, tags: [], isDeleted: true };
      (driveService.findFileByName as any).mockResolvedValue({ id: 'drive-del-single', name: 'del-single.json', modifiedTime: '2024-01-01T00:00:00Z' });

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(tombstone as any);
      });

      // Should use deleteFileById (not deleteRemoteNote) with the Drive file ID
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-del-single');
      expect(storageService.deleteMemory).toHaveBeenCalledWith('del-single');
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
