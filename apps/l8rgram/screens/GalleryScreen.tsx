import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { btn, text } from '@l8r/shared/design-system';
import { PhotoTile } from '../components/PhotoTile';
import type { Photo } from '../types';
import type { ImportProgress, ImportStatus } from '../hooks/usePhotoLibrary';
import type { PermissionResult } from '../services/photoLibrary';

interface Props {
  photos: Photo[];
  status: ImportStatus;
  progress: ImportProgress;
  importError: string | null;
  permission: PermissionResult | null;
  importLibrary: () => void;
  calendarEventCount: number;
  isSyncingCalendar: boolean;
  calendarError: string | null;
  syncCalendar: () => void;
  onLogout: () => void;
}

const COLUMNS = 3;
const ROW_PX = 132;

export const GalleryScreen = ({
  photos,
  status,
  progress,
  importError,
  permission,
  importLibrary,
  calendarEventCount,
  isSyncingCalendar,
  calendarError,
  syncCalendar,
  onLogout,
}: Props) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = Math.ceil(photos.length / COLUMNS);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_PX,
    overscan: 4,
  });

  const busy = status === 'importing' || status === 'requesting';

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-(--color-border-subtle) bg-(--color-surface-base) z-(--z-sticky)">
        <h1 className={text.heading}>Gallery</h1>
        <div className="flex items-center gap-2">
          {photos.length > 0 && (
            <>
              <button
                type="button"
                onClick={syncCalendar}
                disabled={isSyncingCalendar}
                className={`${btn.base} ${btn.secondarySm}`}
              >
                {isSyncingCalendar
                  ? 'Syncing…'
                  : calendarEventCount > 0
                    ? `Calendar (${calendarEventCount})`
                    : 'Sync calendar'}
              </button>
              <button
                type="button"
                onClick={importLibrary}
                disabled={busy}
                className={`${btn.base} ${btn.secondarySm}`}
              >
                {status === 'importing' ? `Importing… ${progress.imported}` : 'Re-import'}
              </button>
            </>
          )}
          <button type="button" onClick={onLogout} className={`${btn.base} ${btn.ghost}`}>
            Sign out
          </button>
        </div>
      </header>

      {calendarError && (
        <div className="px-4 py-2 bg-(--color-danger)/20 text-(--color-danger) text-xs">
          {calendarError === 'reauth_required'
            ? 'Calendar access expired. Sign out and back in to reconnect.'
            : calendarError}
        </div>
      )}

      {permission?.limited && (
        <div className="px-4 py-2 bg-(--color-warning)/20 text-(--color-warning) text-xs">
          Photo access is limited. Grant full access in Settings if photos are missing.
        </div>
      )}

      {importError && (
        <div className="px-4 py-2 bg-(--color-danger)/20 text-(--color-danger) text-xs">
          {importError}
        </div>
      )}

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
          <p className={text.body}>No photos imported yet.</p>
          <p className={text.caption}>
            Grant access to your photo library to build your gallery.
          </p>
          <button
            type="button"
            onClick={importLibrary}
            disabled={busy}
            className={`${btn.base} ${btn.primary}`}
          >
            {busy ? 'Importing…' : 'Import library'}
          </button>
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
