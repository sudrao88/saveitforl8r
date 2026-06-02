import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { card, text } from '@l8r/shared/design-system';
import type { Album, Photo } from '../types';

interface Props {
  albums: Album[];
  photosById: Map<string, Photo>;
  onOpen: (albumId: string) => void;
}

const COLUMNS = 2;
const ROW_PX = 232; // cover (208) + caption block (~24)

const formatRange = (album: Album): string => {
  const start = new Date(album.start);
  const end = new Date(album.end);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return start.toDateString() === end.toDateString() ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
};

export const AlbumsScreen = ({ albums, photosById, onOpen }: Props) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => Math.ceil(albums.length / COLUMNS), [albums.length]);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_PX,
    overscan: 3,
  });

  if (albums.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
        <p className={text.body}>No albums yet.</p>
        <p className={text.caption}>
          Sync your calendar from the Gallery tab to auto-group photos by event.
        </p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto p-2">
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vrow) => {
          const startIdx = vrow.index * COLUMNS;
          const rowAlbums = albums.slice(startIdx, startIdx + COLUMNS);
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
                gap: '8px',
                padding: '0 4px',
              }}
            >
              {rowAlbums.map((album) => {
                const cover = photosById.get(album.coverPhotoId);
                return (
                  <button
                    type="button"
                    key={album.id}
                    onClick={() => onOpen(album.id)}
                    className={`${card.interactive} overflow-hidden text-left flex flex-col`}
                  >
                    <div className="aspect-square bg-(--color-surface-raised) overflow-hidden">
                      {cover?.thumbnailUri ? (
                        <img
                          src={cover.thumbnailUri}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className={`${text.subheading} truncate`}>{album.title}</div>
                      <div className={`${text.caption} truncate`}>
                        {formatRange(album)} · {album.photoIds.length}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
