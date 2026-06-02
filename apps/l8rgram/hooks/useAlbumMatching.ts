import { useEffect, useState } from 'react';
import { matchAlbums } from '../services/albumMatcher';
import {
  getAlbums,
  putPhotos,
  replaceAlbums,
} from '../services/storageService';
import type { Album, LiveCalendarEvent, Photo } from '../types';

const byStartDesc = (a: Album, b: Album) => b.start - a.start;

/**
 * Re-derives albums whenever the photo set or calendar cache changes and
 * persists the result. The matcher is a pure function, so the store ends up in
 * the same state whether this hook runs once or a hundred times — re-import is
 * idempotent. Photos with no matching event are bucketed by device-local day.
 *
 * `photos` is the patched array (with up-to-date `albumIds`) so consumers can
 * render album membership without round-tripping through IDB.
 */
export const useAlbumMatching = (photos: Photo[], events: LiveCalendarEvent[]) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [patchedPhotos, setPatchedPhotos] = useState<Photo[]>(photos);
  const [isMatching, setIsMatching] = useState(false);

  // Hydrate from the encrypted store so the Albums tab is populated instantly
  // on launch, before the first re-match completes.
  useEffect(() => {
    let cancelled = false;
    getAlbums()
      .then((cached) => {
        if (!cancelled) setAlbums([...cached].sort(byStartDesc));
      })
      .catch((e) => console.error('[l8rgram] Failed to load cached albums', e));
    return () => { cancelled = true; };
  }, []);

  // Re-derive whenever inputs change. The matcher is cheap; running it
  // synchronously avoids races between overlapping re-matches.
  useEffect(() => {
    if (photos.length === 0) {
      setAlbums([]);
      setPatchedPhotos([]);
      // Wipe persisted albums too — an empty photo set means no matches.
      void replaceAlbums([]);
      return;
    }

    let cancelled = false;
    setIsMatching(true);
    const result = matchAlbums(photos, events);

    (async () => {
      try {
        // Order matters: write the patched photos before the new album set so
        // a crash between them leaves photos referencing albums that exist
        // (rather than albums whose photoIds point at stale records).
        await putPhotos(result.photos);
        await replaceAlbums(result.albums);
      } catch (e) {
        console.error('[l8rgram] Failed to persist album match', e);
      } finally {
        if (!cancelled) {
          setPatchedPhotos(result.photos);
          setAlbums([...result.albums].sort(byStartDesc));
          setIsMatching(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [photos, events]);

  return { albums, photos: patchedPhotos, isMatching };
};
