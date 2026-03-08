import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMoments } from './useMoments';
import * as storageService from '../services/storageService';
import * as geminiService from '../services/geminiService';
import { Memory, Moment } from '../types';

// Mock the services
vi.mock('../services/storageService');
vi.mock('../services/geminiService');

// Mock the moment creation polling hook
vi.mock('./useMomentCreationPolling', () => ({
  useMomentCreationPolling: () => ({
    startPolling: vi.fn(),
    recoverPending: vi.fn(),
  }),
}));

const makeMemory = (id: string, content = 'test'): Memory => ({
  id,
  content,
  timestamp: Date.now(),
  tags: [],
});

const makeMoment = (id: string, noteIds: string[]): Moment => ({
  id,
  objective: 'Test objective',
  title: 'Test Moment',
  type: 'general',
  noteIds,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('useMoments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getMoments as any).mockResolvedValue([]);
    (storageService.saveMoment as any).mockResolvedValue(undefined);
    (storageService.getMomentSynthesis as any).mockResolvedValue(null);
    (storageService.saveMomentSynthesis as any).mockResolvedValue(undefined);
  });

  it('should load moments on mount', async () => {
    const moments = [makeMoment('m1', ['note-1'])];
    (storageService.getMoments as any).mockResolvedValue(moments);

    const memories = [makeMemory('note-1')];
    const { result } = renderHook(() => useMoments(memories));

    await waitFor(() => {
      expect(result.current.moments).toHaveLength(1);
    });
  });

  describe('removeNoteFromMoments', () => {
    it('should remove a note ID from all moments that reference it', async () => {
      const moments = [
        makeMoment('m1', ['note-1', 'note-2', 'note-3']),
        makeMoment('m2', ['note-2', 'note-4']),
        makeMoment('m3', ['note-5']),
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories: Memory[] = [
        makeMemory('note-1'),
        makeMemory('note-2'),
        makeMemory('note-3'),
        makeMemory('note-4'),
        makeMemory('note-5'),
      ];

      const { result } = renderHook(() => useMoments(memories));

      // Flush the async useEffect that loads moments
      await act(async () => {
        await new Promise(r => setTimeout(r, 0));
      });

      expect(result.current.moments.length).toBe(3);

      // Clear any saveMoment calls from loading phase
      (storageService.saveMoment as any).mockClear();

      await act(async () => {
        await result.current.removeNoteFromMoments('note-2');
      });

      // m1 should have note-2 removed
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-3']);

      // m2 should have note-2 removed
      const m2 = result.current.moments.find(m => m.id === 'm2');
      expect(m2?.noteIds).toEqual(['note-4']);

      // m3 should be unchanged
      const m3 = result.current.moments.find(m => m.id === 'm3');
      expect(m3?.noteIds).toEqual(['note-5']);

      // saveMoment should have been called for m1 and m2 (the affected moments)
      expect(storageService.saveMoment).toHaveBeenCalledTimes(2);
    });

    it('should not modify moments that do not reference the deleted note', async () => {
      const moments = [
        makeMoment('m1', ['note-1', 'note-3']),
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-3')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-99');
      });

      // No changes expected
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-3']);
      expect(storageService.saveMoment).not.toHaveBeenCalled();
    });

    it('should update the updatedAt timestamp on affected moments', async () => {
      const oldTime = Date.now() - 10000;
      const moments = [
        { ...makeMoment('m1', ['note-1', 'note-2']), updatedAt: oldTime },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.updatedAt).toBeGreaterThan(oldTime);
    });

    it('should clear inputHash to invalidate synthesis cache for affected moments', async () => {
      const moments = [
        { ...makeMoment('m1', ['note-1', 'note-2']), inputHash: 'old-hash' },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      // Verify moment has an inputHash before removal
      expect(result.current.moments[0].inputHash).toBe('old-hash');

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // After removal, inputHash should be cleared so loadSynthesis
      // triggers re-synthesis and MomentBubble shows stale indicator
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.inputHash).toBeUndefined();
    });

    it('should not modify deleted moments', async () => {
      const moments = [
        { ...makeMoment('m1', ['note-1', 'note-2']), isDeleted: true },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      // Deleted moments are filtered out of the active list
      await waitFor(() => {
        expect(result.current.moments).toHaveLength(0);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // saveMoment should NOT have been called for the deleted moment
      expect(storageService.saveMoment).not.toHaveBeenCalled();
    });
  });
});
