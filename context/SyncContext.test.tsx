import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { SyncProvider, useSync } from './SyncContext';

// Mock storage values
const mockStorageValues: Record<string, string | null> = {};

// Mock all dependencies
vi.mock('../services/platform', () => ({
  storage: {
    get: vi.fn((key: string) => Promise.resolve(mockStorageValues[key] || null)),
    set: vi.fn((key: string, value: string) => {
      mockStorageValues[key] = value;
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      delete mockStorageValues[key];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(mockStorageValues).forEach(key => delete mockStorageValues[key]);
      return Promise.resolve();
    }),
  },
  isNative: vi.fn().mockReturnValue(false),
}));

vi.mock('../services/storageService', () => ({
  getMemories: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue(undefined),
  deleteMemory: vi.fn().mockResolvedValue(undefined),
  normalizeMemory: vi.fn((memory: any) => memory),
  reconcileEmbeddings: vi.fn().mockResolvedValue({ total: 0, enriched: 0, toQueue: 0, alreadyIndexed: 0, pendingInQueue: 0, error: null, timestamp: Date.now() }),
  getAllMomentsIncludingDeleted: vi.fn().mockResolvedValue([]),
  saveMoment: vi.fn().mockResolvedValue(undefined),
  deleteMomentHard: vi.fn().mockResolvedValue(undefined),
  getMomentSynthesis: vi.fn().mockResolvedValue(null),
  saveMomentSynthesis: vi.fn().mockResolvedValue(undefined),
  deleteMomentSynthesis: vi.fn().mockResolvedValue(undefined),
  getAllCalendarEventsIncludingDeleted: vi.fn().mockResolvedValue([]),
  saveCalendarEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEventHard: vi.fn().mockResolvedValue(undefined),
  getAllTodoItemsIncludingDeleted: vi.fn().mockResolvedValue([]),
  updateTodoItem: vi.fn().mockResolvedValue(undefined),
  deleteTodoItemHard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/googleDriveService', () => ({
  listAllFiles: vi.fn().mockResolvedValue([]),
  downloadFileContent: vi.fn().mockResolvedValue({}),
  downloadMultipleFiles: vi.fn().mockResolvedValue({ contents: new Map(), failures: [] }),
  downloadFilesStreaming: vi.fn().mockImplementation(async (_fileIds: string[], _onFile: any) => ({ failures: [] })),
  uploadFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
  uploadMultipleFiles: vi.fn().mockResolvedValue({ failures: [] }),
  findFileByName: vi.fn().mockResolvedValue(null),
  findAllFilesByName: vi.fn().mockResolvedValue([]),
  cleanupFilesByName: vi.fn().mockResolvedValue(undefined),
  deleteFileById: vi.fn().mockResolvedValue(undefined),
  isLinked: vi.fn().mockResolvedValue(true), // Now async
  deleteRemoteNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/backgroundSyncQueue', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
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
import { storage } from '../services/platform';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SyncProvider>{children}</SyncProvider>
);

/**
 * Helper: set up both downloadMultipleFiles and downloadFilesStreaming mocks
 * from a Map of fileId → content. The streaming mock calls onFile for each entry.
 */
const mockDownloads = (contentsMap: Map<string, any>, failures: string[] = []) => {
  (driveService.downloadMultipleFiles as any).mockResolvedValue({
    contents: contentsMap,
    failures,
  });
  (driveService.downloadFilesStreaming as any).mockImplementation(
    async (fileIds: string[], onFile: (fileId: string, content: any) => Promise<void>) => {
      for (const fileId of fileIds) {
        const content = contentsMap.get(fileId);
        if (content) {
          await onFile(fileId, content);
        }
      }
      return { failures };
    }
  );
};

describe('SyncContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // Clear mock storage values
    Object.keys(mockStorageValues).forEach(key => delete mockStorageValues[key]);

    // cleanupFilesByName is a thin wrapper over findAllFilesByName +
    // deleteFileById in the real module. Wire the default mock the same way
    // so existing assertions on deleteFileById keep verifying behavior.
    (driveService.cleanupFilesByName as any).mockImplementation(
      async (filename: string, keepId?: string) => {
        const files = await (driveService.findAllFilesByName as any)(filename);
        for (const file of files) {
          if (keepId && file.id === keepId) continue;
          try {
            await (driveService.deleteFileById as any)(file.id);
          } catch {
            // mirror real helper: swallow individual delete failures
          }
        }
      },
    );
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

  describe('delta sync', () => {
    it('should upload local-only memories to Drive', async () => {
      const localMemories = [
        { id: 'local-1', content: 'Test memory', timestamp: 1000, tags: [] },
      ];
      (storageService.getMemories as any).mockResolvedValue(localMemories);
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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
      // Set up streaming download mock
      mockDownloads(new Map([['drive-file-1', remoteContent]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(driveService.downloadFilesStreaming).toHaveBeenCalled();
      expect(storageService.saveMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'remote-1' })
      );
    });

    it('routes downloaded memories through normalizeMemory before save', async () => {
      // Legacy record from an older client: has processingError but no
      // enrichmentStatus. Without normalization at the sync boundary, it
      // would land in IDB and React state with enrichmentStatus undefined,
      // breaking strict-equality checks (icon rendering, online auto-retry).
      const legacyRemote = {
        id: 'legacy-1',
        content: 'Old failed memory',
        timestamp: 2000,
        tags: [],
        processingError: true,
      };

      (storageService.getMemories as any).mockResolvedValue([]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'legacy-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-file-1', legacyRemote]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(storageService.normalizeMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'legacy-1', processingError: true })
      );
    });

    it('should prefer remote version when remote timestamp is newer', async () => {
      const localMem = { id: 'mem-1', content: 'Old local', timestamp: 1000, tags: [] };
      const remoteMem = { id: 'mem-1', content: 'New remote', timestamp: 2000, tags: [] };

      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-file-1', remoteMem]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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
      mockDownloads(new Map([['drive-file-1', remoteMem]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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
      mockDownloads(new Map([['drive-file-1', deletedRemote]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(storageService.deleteMemory).toHaveBeenCalledWith('mem-1');
    });

    it('should skip unchanged files when snapshot matches remote modifiedTime', async () => {
      // Set up a snapshot where mem-1 has same modifiedTime as remote
      const snapshot = { 'mem-1': '2024-01-01T00:00:00Z' };
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify(snapshot);
      mockStorageValues['gdrive_last_sync_time'] = '5000'; // Last sync at t=5000

      const localMem = { id: 'mem-1', content: 'Unchanged', timestamp: 1000, tags: [] };
      (storageService.getMemories as any).mockResolvedValue([localMem]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-file-1', name: 'mem-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Should NOT download since snapshot matches → no network call for content
      expect(driveService.downloadFilesStreaming).toHaveBeenCalledWith([], expect.any(Function));
      // Should NOT upload since local timestamp (1000) < lastSyncTime (5000)
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith([]);
    });

    it('should delete local note when remote was deleted by another device', async () => {
      // Snapshot says mem-1 existed remotely
      const snapshot = { 'mem-1': '2024-01-01T00:00:00Z' };
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify(snapshot);
      mockStorageValues['gdrive_last_sync_time'] = '5000';

      const localMem = { id: 'mem-1', content: 'Still here locally', timestamp: 1000, tags: [] };
      (storageService.getMemories as any).mockResolvedValue([localMem]);
      // Remote listing is empty — the file was deleted from Drive
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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

    it('should upload pending memories so notes survive an early app close', async () => {
      // Notes created via Android share intent are in-flight (submitting /
      // processing) when the user immediately closes the app. They must be
      // pushed to Drive on the spot — otherwise the post-enrichment upload
      // never fires and the note is left local-only.
      const pendingMem = {
          id: 'pending-1',
          content: 'Pending',
          timestamp: 1000,
          tags: [],
          isPending: true,
          enrichmentStatus: 'submitting',
      };
      (driveService.findFileByName as any).mockResolvedValue(null);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(pendingMem as any);
      });

      expect(driveService.uploadFile).toHaveBeenCalledWith(
        'pending-1.json',
        pendingMem,
        undefined
      );
    });

    it('should delete remote file and local tombstone on single sync of deleted memory', async () => {
      const tombstone = { id: 'del-single', content: '', timestamp: 2000, tags: [], isDeleted: true };
      (driveService.findAllFilesByName as any).mockResolvedValue([
        { id: 'drive-del-single', name: 'del-single.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(tombstone as any);
      });

      // Should use deleteFileById (not deleteRemoteNote) with the Drive file ID
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-del-single');
      expect(storageService.deleteMemory).toHaveBeenCalledWith('del-single');
    });

    it('should delete every duplicate Drive file when single-syncing a deleted memory', async () => {
      // Drive permits duplicate filenames, and concurrent uploads racing a
      // delete can leave more than one file with the same name. Surviving
      // duplicates would be re-downloaded on the next listAllFiles and
      // resurrect the note. The deletion path must remove all of them.
      const tombstone = { id: 'del-dup', content: '', timestamp: 2000, tags: [], isDeleted: true };
      (driveService.findAllFilesByName as any).mockResolvedValue([
        { id: 'drive-del-dup-1', name: 'del-dup.json', modifiedTime: '2024-01-01T00:00:00Z' },
        { id: 'drive-del-dup-2', name: 'del-dup.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncFile(tombstone as any);
      });

      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-del-dup-1');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-del-dup-2');
    });

    it('should delete remote moment file and synthesis and hard-delete locally on single sync of deleted moment', async () => {
      // Mirrors the note-deletion semantics: a single moment sync of a
      // tombstone should remove the Drive files and the local tombstone
      // immediately, rather than uploading the tombstone and waiting for
      // the next delta sync (which races with background updates).
      const tombstone = {
        id: 'mom-del',
        objective: 'Test',
        title: 'Test',
        type: 'general',
        noteIds: [],
        createdAt: 1000,
        updatedAt: 2000,
        isDeleted: true,
      };

      (driveService.findAllFilesByName as any).mockImplementation((name: string) => {
        if (name === 'moment-mom-del.json') {
          return Promise.resolve([{ id: 'drive-mom-del', name, modifiedTime: '2024-01-01T00:00:00Z' }]);
        }
        if (name === 'moment-synthesis-mom-del.json') {
          return Promise.resolve([{ id: 'drive-synth-mom-del', name, modifiedTime: '2024-01-01T00:00:00Z' }]);
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncMoment(tombstone as any);
      });

      // Both moment file and synthesis file should be deleted from Drive.
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-del');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-synth-mom-del');
      // Local tombstone hard-deleted (cascades to the synthesis cache).
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-del');
      // The tombstone must NOT be uploaded — that was the buggy path that
      // raced with background activity on the other device.
      expect(driveService.uploadFile).not.toHaveBeenCalled();
    });

    it('should delete every duplicate moment and synthesis file when single-syncing a deleted moment', async () => {
      // The user-reported resurrection bug: each delete only removed one file
      // ID, while Drive carried multiple copies of the same moment because of
      // a race with re-synthesis uploads. Subsequent manual syncs would pull
      // the surviving duplicate back down.
      const tombstone = {
        id: 'mom-dup',
        objective: 'Test',
        title: 'Test',
        type: 'general',
        noteIds: [],
        createdAt: 1000,
        updatedAt: 2000,
        isDeleted: true,
      };

      (driveService.findAllFilesByName as any).mockImplementation((name: string) => {
        if (name === 'moment-mom-dup.json') {
          return Promise.resolve([
            { id: 'drive-mom-dup-1', name, modifiedTime: '2024-01-01T00:00:00Z' },
            { id: 'drive-mom-dup-2', name, modifiedTime: '2024-01-02T00:00:00Z' },
          ]);
        }
        if (name === 'moment-synthesis-mom-dup.json') {
          return Promise.resolve([
            { id: 'drive-synth-dup-1', name, modifiedTime: '2024-01-01T00:00:00Z' },
            { id: 'drive-synth-dup-2', name, modifiedTime: '2024-01-02T00:00:00Z' },
          ]);
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncMoment(tombstone as any);
      });

      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-dup-1');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-dup-2');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-synth-dup-1');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-synth-dup-2');
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-dup');
    });

    it('should not resurrect a moment that was deleted on another device', async () => {
      // Background activity (e.g. addNoteToMoment from enrichment) calls
      // syncMoment with an alive moment. If the file is missing from Drive
      // but our snapshot says we synced it before, the deletion was made
      // by another device — propagate the deletion instead of re-uploading.
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify({
        'moment-mom-1': '2024-01-01T00:00:00Z',
      });

      const aliveLocal = {
        id: 'mom-1',
        objective: 'Test',
        title: 'Test',
        type: 'general',
        noteIds: ['n1'],
        createdAt: 1000,
        updatedAt: 9000, // bumped locally by enrichment match
      };

      (driveService.findFileByName as any).mockResolvedValue(null);
      (driveService.findAllFilesByName as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.syncMoment(aliveLocal as any);
      });

      // Should not re-upload — that would resurrect the deleted moment.
      expect(driveService.uploadFile).not.toHaveBeenCalled();
      // Should propagate the deletion locally.
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-1');
    });
  });

  describe('moment delta sync', () => {
    const makeMoment = (id: string, updatedAt: number, overrides?: any) => ({
      id,
      objective: 'Test',
      title: 'Test Moment',
      type: 'general',
      noteIds: [],
      createdAt: 1000,
      updatedAt,
      ...overrides,
    });

    it('should download remote-only moments to local', async () => {
      const remoteMoment = makeMoment('mom-1', 2000);

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-mom-1', remoteMoment]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(storageService.saveMoment).toHaveBeenCalledWith(remoteMoment);
    });

    it('should prefer remote moment when remote updatedAt is newer', async () => {
      const localMoment = makeMoment('mom-1', 1000);
      const remoteMoment = makeMoment('mom-1', 2000, { title: 'Updated Title' });

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-mom-1', remoteMoment]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(storageService.saveMoment).toHaveBeenCalledWith(remoteMoment);
    });

    it('should upload local moment when local updatedAt is newer', async () => {
      const localMoment = makeMoment('mom-1', 3000);
      const remoteMoment = makeMoment('mom-1', 1000);

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-mom-1', remoteMoment]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Local is newer — should be uploaded with the Drive file ID for PATCH
      expect(storageService.saveMoment).not.toHaveBeenCalled();
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'moment-mom-1.json',
            content: localMoment,
            existingFileId: 'drive-mom-1',
          }),
        ])
      );
    });

    it('should upload local-only moments to Drive', async () => {
      const localMoment = makeMoment('mom-local', 2000);

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'moment-mom-local.json',
            content: localMoment,
          }),
        ])
      );
    });

    it('should handle local deleted moment tombstone by deleting remote and hard-deleting local', async () => {
      const deletedMoment = makeMoment('mom-del', 2000, { isDeleted: true });

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([deletedMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-del', name: 'moment-mom-del.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-del');
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-del');
    });

    it('should handle remote deleted moment by deleting local', async () => {
      const remoteMoment = makeMoment('mom-1', 2000, { isDeleted: true });

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-mom-1', remoteMoment]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-1');
    });

    it('should delete local moment when remote was deleted by another device', async () => {
      const snapshot = { 'moment-mom-1': '2024-01-01T00:00:00Z' };
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify(snapshot);
      mockStorageValues['gdrive_last_sync_time'] = '5000';

      const localMoment = makeMoment('mom-1', 1000);

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Local moment should be deleted because another device removed it from Drive
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-1');
    });

    it('should hard-delete local moment when remote tombstone arrives, even if local updatedAt is newer', async () => {
      // Regression test for moment deletion sync bug:
      // Background activity on Device B (addNoteToMoment, markMomentSeen,
      // loadSynthesis, recoverPendingResynthesis) bumps the local
      // updatedAt. Without this fix, the streaming download handler would
      // route the tombstone to "upload local" instead of deleting, silently
      // discarding the deletion and resurrecting the moment elsewhere.
      const remoteTombstone = makeMoment('mom-1', 1500, { isDeleted: true });
      const localMoment = makeMoment('mom-1', 5000); // local has newer updatedAt

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-02T00:00:00Z' },
      ]);
      mockDownloads(new Map([['drive-mom-1', remoteTombstone]]));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Tombstone wins regardless of timestamp
      expect(storageService.deleteMomentHard).toHaveBeenCalledWith('mom-1');
      expect(storageService.saveMoment).not.toHaveBeenCalledWith(localMoment);
    });

    it('should plan duplicate Drive files for deletion alongside the canonical when local moment is a tombstone', async () => {
      // doDeltaSync identifies duplicates from listAllFiles and queues them
      // for deletion at planning time, so executeSyncPlan stays a simple
      // execution engine — no per-item findAllFilesByName lookups.
      const snapshot = { 'moment-mom-dup': '2024-01-01T00:00:00Z' };
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify(snapshot);
      mockStorageValues['gdrive_last_sync_time'] = '5000';

      const tombstone = makeMoment('mom-dup', 9000, { isDeleted: true });

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([tombstone]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-dup-1', name: 'moment-mom-dup.json', modifiedTime: '2024-01-02T00:00:00Z' },
        { id: 'drive-mom-dup-2', name: 'moment-mom-dup.json', modifiedTime: '2024-01-03T00:00:00Z' },
        { id: 'drive-synth-dup-1', name: 'moment-synthesis-mom-dup.json', modifiedTime: '2024-01-02T00:00:00Z' },
        { id: 'drive-synth-dup-2', name: 'moment-synthesis-mom-dup.json', modifiedTime: '2024-01-03T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Both the canonical and the duplicate file ID should be deleted.
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-dup-1');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-mom-dup-2');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-synth-dup-1');
      expect(driveService.deleteFileById).toHaveBeenCalledWith('drive-synth-dup-2');
      // executeSyncPlan must not fall back to findAllFilesByName lookups.
      expect(driveService.findAllFilesByName).not.toHaveBeenCalled();
    });

    it('should skip unchanged moment files when snapshot matches remote modifiedTime', async () => {
      const snapshot = { 'moment-mom-1': '2024-01-01T00:00:00Z' };
      mockStorageValues['gdrive_remote_snapshot'] = JSON.stringify(snapshot);
      mockStorageValues['gdrive_last_sync_time'] = '5000';

      const localMoment = makeMoment('mom-1', 1000);

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.getAllMomentsIncludingDeleted as any).mockResolvedValue([localMoment]);
      (driveService.listAllFiles as any).mockResolvedValue([
        { id: 'drive-mom-1', name: 'moment-mom-1.json', modifiedTime: '2024-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // Should NOT download since snapshot matches
      expect(driveService.downloadFilesStreaming).toHaveBeenCalledWith([], expect.any(Function));
      // Should NOT upload since moment updatedAt (1000) < lastSyncTime (5000)
      expect(driveService.uploadMultipleFiles).toHaveBeenCalledWith([]);
    });
  });

  describe('periodic sync', () => {
    it('should trigger sync at 5-minute intervals when tab is visible', async () => {
      // Ensure tab is visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      // listAllFiles is called during sync — use it as a proxy for sync invocation
      (driveService.listAllFiles as any).mockResolvedValue([]);
      (driveService.isLinked as any).mockResolvedValue(true);

      // Initial call count after mount
      const initialCalls = (driveService.listAllFiles as any).mock.calls.length;

      // Advance 5 minutes (periodic interval)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      // Advance past debounce
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect((driveService.listAllFiles as any).mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('should NOT trigger sync at interval when tab is hidden', async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      (driveService.listAllFiles as any).mockResolvedValue([]);
      (driveService.isLinked as any).mockResolvedValue(true);

      const initialCalls = (driveService.listAllFiles as any).mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2500);
      });

      // Should NOT have synced because tab is hidden
      expect((driveService.listAllFiles as any).mock.calls.length).toBe(initialCalls);
    });

    it('should sync on tab re-focus when last sync is stale', async () => {
      // Set last sync time to 3 minutes ago (stale — beyond 2-minute threshold)
      mockStorageValues['gdrive_last_sync_time'] = (Date.now() - 3 * 60 * 1000).toString();

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      (driveService.listAllFiles as any).mockResolvedValue([]);
      (driveService.isLinked as any).mockResolvedValue(true);

      const initialCalls = (driveService.listAllFiles as any).mock.calls.length;

      // Simulate tab becoming visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Wait for async isStale check and debounce
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect((driveService.listAllFiles as any).mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('should NOT sync on tab re-focus when last sync is recent', async () => {
      // Set last sync time to 30 seconds ago (fresh — within 2-minute threshold)
      mockStorageValues['gdrive_last_sync_time'] = (Date.now() - 30 * 1000).toString();

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      (driveService.listAllFiles as any).mockResolvedValue([]);
      (driveService.isLinked as any).mockResolvedValue(true);

      const initialCalls = (driveService.listAllFiles as any).mock.calls.length;

      // Simulate tab becoming visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      // Should NOT have synced because last sync was recent
      expect((driveService.listAllFiles as any).mock.calls.length).toBe(initialCalls);
    });
  });

  describe('sync error handling', () => {
    it('should set syncError on auth failure', async () => {
      (storageService.getMemories as any).mockRejectedValue(new Error('Unauthorized 401'));

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        // Start sync and immediately attach a catch handler to prevent unhandled rejection
        const syncPromise = result.current.sync().catch(() => {
          // Expected rejection — error state is set internally by SyncContext
        });
        // Advance past debounce timer (async version flushes microtasks properly)
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
      });

      // syncError should be set (auth-related or generic)
      expect(result.current.syncError).toBeTruthy();
    });

    it('should not sync when not linked', async () => {
      (driveService.isLinked as any).mockResolvedValue(false);

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
      });

      // No Drive operations should have been called
      expect(driveService.listAllFiles).not.toHaveBeenCalled();
    });
  });

  describe('visibility-aware scheduling', () => {
    it('should set up periodic interval on mount', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

      renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Should have registered at least one interval for periodic sync
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it('should adjust interval on visibility change', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

      renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Record how many setInterval calls happened during mount
      const mountCalls = setIntervalSpy.mock.calls.length;

      // Simulate going to background
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(100);
      });

      // Should have registered a new interval (background interval)
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(mountCalls);

      // The last call should use the background interval (15 min = 900000ms)
      const lastCall = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastCall[1]).toBe(15 * 60 * 1000);

      setIntervalSpy.mockRestore();
    });

    it('should not trigger sync on visibility change when data is fresh', async () => {
      // Mark data as fresh
      mockStorageValues['gdrive_last_sync_time'] = String(Date.now());

      renderHook(() => useSync(), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      (driveService.listAllFiles as any).mockClear();

      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(2500);
      });

      // Should NOT trigger sync since data is fresh
      expect(driveService.listAllFiles).not.toHaveBeenCalled();
    });
  });
});
