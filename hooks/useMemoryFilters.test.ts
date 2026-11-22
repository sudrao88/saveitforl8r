import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMemoryFilters, memoryHasImage, memoryHasAttachment } from './useMemoryFilters';
import type { Memory, Attachment } from '../types';

const att = (type: 'image' | 'file', data = 'data:x'): Attachment =>
  ({ id: type + Math.random(), type, mimeType: type === 'image' ? 'image/png' : 'application/pdf', name: 'a', data });

const mem = (id: string, extra: Partial<Memory> = {}): Memory =>
  ({ id, timestamp: 0, content: id, tags: [], ...extra });

const plain = mem('plain');
const withImage = mem('img', { attachments: [att('image')] });
const withFile = mem('file', { attachments: [att('file')] });
const withBoth = mem('both', { attachments: [att('image'), att('file')] });
const legacy = mem('legacy', { image: 'data:image/jpeg;base64,abc' });
const deferredLegacy = mem('deferred', { image: '', attachments: [], _attachmentsDeferred: true });

describe('memory filter predicates', () => {
  it('detects images, including legacy and deferred-sync notes', () => {
    expect(memoryHasImage(plain)).toBe(false);
    expect(memoryHasImage(withFile)).toBe(false);
    expect(memoryHasImage(withImage)).toBe(true);
    expect(memoryHasImage(legacy)).toBe(true);
    expect(memoryHasImage(deferredLegacy)).toBe(true);
    expect(memoryHasImage(mem('deferredImg', { attachments: [att('image', '')], _attachmentsDeferred: true }))).toBe(true);
  });

  it('detects non-image file attachments', () => {
    expect(memoryHasAttachment(plain)).toBe(false);
    expect(memoryHasAttachment(withImage)).toBe(false);
    expect(memoryHasAttachment(legacy)).toBe(false);
    expect(memoryHasAttachment(withFile)).toBe(true);
  });
});

describe('useMemoryFilters', () => {
  const all = [plain, withImage, withFile, withBoth, legacy];

  it('combines active filters with AND and clears them', () => {
    const { result } = renderHook(() => useMemoryFilters(all));
    expect(result.current.filteredMemories).toHaveLength(5);

    act(() => result.current.toggleFilter('hasImage'));
    expect(result.current.filteredMemories.map(m => m.id)).toEqual(['img', 'both', 'legacy']);

    act(() => result.current.toggleFilter('hasAttachment'));
    expect(result.current.filteredMemories.map(m => m.id)).toEqual(['both']);
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => result.current.clearFilters());
    expect(result.current.filteredMemories).toHaveLength(5);
    expect(result.current.hasActiveFilters).toBe(false);
  });
});
