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
  uploadFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
  uploadMultipleFiles: vi.fn().mockResolvedValue({ failures: [] }),
  findFileByName: vi.fn().mockResolvedValue(null),
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

describe('SyncContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // Clear mock storage values
    Object.keys(mockStorageValues).forEach(key => delete mockStorageValues[key]);
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
      // downloadMultipleFiles returns a Map of fileId → content
      const contentsMap = new Map([['drive-file-1', remoteContent]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

      const { result } = renderHook(() => useSync(), { wrapper });

      await act(async () => {
        const syncPromise = result.current.sync();
        await vi.advanceTimersByTimeAsync(2500);
        await syncPromise;
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
      const contentsMap = new Map([['drive-file-1', remoteMem]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      const contentsMap = new Map([['drive-file-1', deletedRemote]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      expect(driveService.downloadMultipleFiles).toHaveBeenCalledWith([]);
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
      const contentsMap = new Map([['drive-mom-1', remoteMoment]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      const contentsMap = new Map([['drive-mom-1', remoteMoment]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      const contentsMap = new Map([['drive-mom-1', remoteMoment]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      const contentsMap = new Map([['drive-mom-1', remoteMoment]]);
      (driveService.downloadMultipleFiles as any).mockResolvedValue({
        contents: contentsMap,
        failures: [],
      });

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
      expect(driveService.downloadMultipleFiles).toHaveBeenCalledWith([]);
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
