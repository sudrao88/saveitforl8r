import { useMemo, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePhotoLibrary } from './hooks/usePhotoLibrary';
import { useLiveCalendar } from './hooks/useLiveCalendar';
import { useAlbumMatching } from './hooks/useAlbumMatching';
import { usePhotoEnrichment } from './hooks/usePhotoEnrichment';
import { LoginScreen } from './screens/LoginScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { AlbumsScreen } from './screens/AlbumsScreen';
import { AlbumDetailScreen } from './screens/AlbumDetailScreen';
import { SearchScreen } from './screens/SearchScreen';
import type { Photo } from './types';

type Tab = 'gallery' | 'albums' | 'search';

// Bottom-nav item — kept inline (one-off, only two entries). Composes
// design-system tokens via class strings; no raw Tailwind colors.
const NAV_BTN_BASE =
  'flex-1 flex flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors duration-(--duration-fast)';
const NAV_BTN_ACTIVE = 'text-(--color-accent)';
const NAV_BTN_INACTIVE = 'text-(--color-text-tertiary) hover:text-(--color-text-secondary)';

export default function App() {
  const { authStatus, authError, login, logout } = useAuth();

  if (authStatus !== 'linked') {
    return (
      <LoginScreen
        onLogin={login}
        isAuthenticating={authStatus === 'authenticating'}
        error={authError}
      />
    );
  }

  return <Authed onLogout={logout} />;
}

const Authed = ({ onLogout }: { onLogout: () => void }) => {
  const {
    photos,
    status,
    progress,
    error: importError,
    permission,
    importLibrary,
  } = usePhotoLibrary();
  const {
    events,
    isSyncing: isSyncingCalendar,
    error: calendarError,
    syncNow: syncCalendar,
  } = useLiveCalendar(photos);
  const {
    albums,
    photos: matchedPhotos,
  } = useAlbumMatching(photos, events);

  // Background per-photo caption/tags. `enrichedById` carries the freshest
  // result so the UI shows captions/tags immediately, regardless of when the
  // encrypted store write lands.
  const { enrichedById } = usePhotoEnrichment(matchedPhotos.length > 0 ? matchedPhotos : photos);

  const [tab, setTab] = useState<Tab>('gallery');
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);

  // The list everything renders from: album-matched photos (with up-to-date
  // albumIds) merged with any enrichment patches produced this session.
  const displayPhotos = useMemo(() => {
    const source = matchedPhotos.length > 0 ? matchedPhotos : photos;
    if (enrichedById.size === 0) return source;
    return source.map((p) => {
      const patch = enrichedById.get(p.id);
      return patch ? { ...p, ...patch } : p;
    });
  }, [matchedPhotos, photos, enrichedById]);

  // Keyed for O(1) album lookups.
  const photosById = useMemo(
    () => new Map<string, Photo>(displayPhotos.map((p) => [p.id, p])),
    [displayPhotos],
  );

  const openAlbum = openAlbumId ? albums.find((a) => a.id === openAlbumId) ?? null : null;

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 min-h-0 flex flex-col">
        {openAlbum ? (
          <AlbumDetailScreen
            album={openAlbum}
            photosById={photosById}
            onBack={() => setOpenAlbumId(null)}
          />
        ) : tab === 'gallery' ? (
          <GalleryScreen
            photos={displayPhotos}
            status={status}
            progress={progress}
            importError={importError}
            permission={permission}
            importLibrary={importLibrary}
            calendarEventCount={events.length}
            isSyncingCalendar={isSyncingCalendar}
            calendarError={calendarError}
            syncCalendar={syncCalendar}
            onLogout={onLogout}
          />
        ) : tab === 'albums' ? (
          <AlbumsScreen
            albums={albums}
            photosById={photosById}
            onOpen={setOpenAlbumId}
          />
        ) : (
          <SearchScreen photos={displayPhotos} albums={albums} />
        )}
      </main>

      {!openAlbum && (
        <nav
          aria-label="Primary"
          className="flex items-stretch border-t border-(--color-border-subtle) bg-(--color-surface-base) z-(--z-sticky) rounded-t-(--radius-xl) pb-[var(--sab)]"
        >
          <button
            type="button"
            onClick={() => setTab('gallery')}
            aria-pressed={tab === 'gallery'}
            className={`${NAV_BTN_BASE} ${tab === 'gallery' ? NAV_BTN_ACTIVE : NAV_BTN_INACTIVE}`}
          >
            Gallery
          </button>
          <button
            type="button"
            onClick={() => setTab('albums')}
            aria-pressed={tab === 'albums'}
            className={`${NAV_BTN_BASE} ${tab === 'albums' ? NAV_BTN_ACTIVE : NAV_BTN_INACTIVE}`}
          >
            Albums
          </button>
          <button
            type="button"
            onClick={() => setTab('search')}
            aria-pressed={tab === 'search'}
            className={`${NAV_BTN_BASE} ${tab === 'search' ? NAV_BTN_ACTIVE : NAV_BTN_INACTIVE}`}
          >
            Search
          </button>
        </nav>
      )}
    </div>
  );
};
