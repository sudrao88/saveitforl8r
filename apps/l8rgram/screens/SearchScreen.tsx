import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { btn, input, text } from '@l8r/shared/design-system';
import { PhotoTile } from '../components/PhotoTile';
import { useGallerySearch } from '../hooks/useGallerySearch';
import type { Album, Photo } from '../types';

interface Props {
  photos: Photo[];
  albums: Album[];
}

const COLUMNS = 3;
const ROW_PX = 132;

export const SearchScreen = ({ photos, albums }: Props) => {
  const { query, status, results, reasoning, error, search, clear } = useGallerySearch(photos, albums);
  const [draft, setDraft] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = Math.ceil(results.length / COLUMNS);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_PX,
    overscan: 4,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void search(draft);
  };

  const onClear = () => {
    setDraft('');
    clear();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-(--color-border-subtle) bg-(--color-surface-base) z-(--z-sticky)">
        <h1 className={text.heading}>Search</h1>
        <form onSubmit={onSubmit} className="mt-2 flex items-center gap-2">
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search your photos…"
            aria-label="Search your photos"
            className={input.base}
          />
          <button
            type="submit"
            disabled={status === 'searching' || !draft.trim()}
            className={`${btn.base} ${btn.primarySm}`}
          >
            {status === 'searching' ? 'Searching…' : 'Search'}
          </button>
          {query && (
            <button type="button" onClick={onClear} className={`${btn.base} ${btn.ghost}`}>
              Clear
            </button>
          )}
        </form>
      </header>

      {error && (
        <div className="px-4 py-2 bg-(--color-danger)/20 text-(--color-danger) text-xs">{error}</div>
      )}

      {status === 'done' && reasoning && (
        <div className="px-4 py-2 text-(--color-text-tertiary) text-xs">{reasoning}</div>
      )}

      {status === 'idle' ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
          <p className={text.body}>Search across your gallery.</p>
          <p className={text.caption}>
            Try “sunset at the beach”, “birthday cake”, or “hike last summer”.
          </p>
        </div>
      ) : status === 'done' && results.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
          <p className={text.body}>No matching photos.</p>
          <p className={text.caption}>Try a different search.</p>
        </div>
      ) : results.length > 0 ? (
        <div ref={parentRef} className="flex-1 overflow-auto p-1">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((vrow) => {
              const startIdx = vrow.index * COLUMNS;
              const rowPhotos = results.slice(startIdx, startIdx + COLUMNS);
              return (
                <div
                  key={vrow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vrow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
                    gap: '4px',
                  }}
                >
                  {rowPhotos.map((p) => (
                    <PhotoTile key={p.id} photo={p} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
};
