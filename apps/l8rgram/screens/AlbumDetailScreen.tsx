import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { btn, text } from '@l8r/shared/design-system';
import { PhotoTile } from '../components/PhotoTile';
import type { Album, Photo } from '../types';

interface Props {
  album: Album;
  photosById: Map<string, Photo>;
  onBack: () => void;
}

const COLUMNS = 3;
const ROW_PX = 132;

const formatDateTime = (album: Album): string => {
  const start = new Date(album.start);
  const end = new Date(album.end);
  const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const sameDay = start.toDateString() === end.toDateString();
  if (album.source === 'untitled' || sameDay) {
    if (album.source === 'untitled') {
      return start.toLocaleDateString(undefined, dateFmt);
    }
    return `${start.toLocaleDateString(undefined, dateFmt)} · ${start.toLocaleTimeString(undefined, timeFmt)} – ${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${start.toLocaleDateString(undefined, dateFmt)} – ${end.toLocaleDateString(undefined, dateFmt)}`;
};

export const AlbumDetailScreen = ({ album, photosById, onBack }: Props) => {
  const photos = useMemo(
    () => album.photoIds.map((id) => photosById.get(id)).filter((p): p is Photo => !!p),
    [album.photoIds, photosById],
  );
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = Math.ceil(photos.length / COLUMNS);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_PX,
    overscan: 4,
  });

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-start gap-3 px-4 py-3 border-b border-(--color-border-subtle) bg-(--color-surface-base) z-(--z-sticky)">
        <button type="button" onClick={onBack} className={`${btn.base} ${btn.ghost}`} aria-label="Back">
          ←
        </button>
        <div className="flex flex-col flex-1 min-w-0">
          <h2 className={`${text.heading} truncate`}>{album.title}</h2>
          <p className={`${text.caption} truncate`}>{formatDateTime(album)}</p>
          {album.location && (
            <p className={`${text.caption} truncate`}>{album.location}</p>
          )}
          {album.description && (
            <p className={`${text.body} mt-1 line-clamp-2`}>{album.description}</p>
          )}
        </div>
        <span className={text.caption}>{photos.length}</span>
      </header>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
          <p className={text.body}>No photos in this album.</p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto p-1">
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vrow) => {
              const startIdx = vrow.index * COLUMNS;
              const rowPhotos = photos.slice(startIdx, startIdx + COLUMNS);
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
      )}
    </div>
  );
};
