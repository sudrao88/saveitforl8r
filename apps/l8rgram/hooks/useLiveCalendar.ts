import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthorizedFetch } from '@l8r/shared/auth';
import { getProxyUrl } from '@l8r/shared/ai';
import {
  getCalendarEvents,
  putCalendarEvents,
  getCalendarLastSyncedAt,
  setCalendarLastSyncedAt,
} from '../services/storageService';
import type { Photo, LiveCalendarEvent } from '../types';

// Re-sync no more than once per 5 minutes unless the user explicitly taps
// "Sync calendar" (syncNow), which always bypasses the throttle.
const SYNC_THROTTLE_MS = 5 * 60 * 1000;

const byStartAsc = (a: LiveCalendarEvent, b: LiveCalendarEvent) => a.start - b.start;

// A raw Google Calendar event (the subset we consume) as returned by the proxy.
interface GoogleEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  organizer?: { email?: string };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

// Google gives either a `dateTime` (timed) or a `date` (all-day, no time).
// All-day dates have no timezone — treat the local midnight as the boundary.
const toEpochMs = (slot?: { dateTime?: string; date?: string }): number => {
  if (!slot) return NaN;
  if (slot.dateTime) return Date.parse(slot.dateTime);
  if (slot.date) return Date.parse(`${slot.date}T00:00:00`);
  return NaN;
};

const mapEvent = (e: GoogleEvent): LiveCalendarEvent => ({
  id: e.id,
  title: e.summary ?? '(no title)',
  start: toEpochMs(e.start),
  end: toEpochMs(e.end),
  location: e.location,
  description: e.description,
  calendarId: e.organizer?.email,
  allDay: Boolean(e.start?.date),
});

/**
 * Syncs the user's live Google Calendar across the time span of their imported
 * photos (`min(capturedAt)…max(capturedAt)`), following `nextPageToken` to pull
 * every event, and persists them to the encrypted `calendarCache` keyed by
 * `event.id`. The initial fetch is user-triggered via `syncNow()`; subsequent
 * automatic re-syncs (when the photo span changes) are throttled to 5 minutes.
 */
export const useLiveCalendar = (photos: Photo[]) => {
  const [events, setEvents] = useState<LiveCalendarEvent[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guards against overlapping syncs (the auto effect + a manual tap).
  const inFlight = useRef(false);

  // Hydrate cached events + last-synced timestamp on mount.
  useEffect(() => {
    let cancelled = false;
    getCalendarEvents()
      .then((cached) => {
        if (!cancelled) setEvents([...cached].sort(byStartAsc));
      })
      .catch((e) => console.error('[l8rgram] Failed to load cached calendar', e));
    getCalendarLastSyncedAt()
      .then((ts) => {
        if (!cancelled) setLastSyncedAt(ts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const runSync = useCallback(
    async (force: boolean) => {
      if (photos.length === 0) return; // nothing to span — no-op
      if (inFlight.current) return;

      // Throttle automatic re-syncs; syncNow() passes force=true to bypass.
      if (!force && lastSyncedAt != null && Date.now() - lastSyncedAt < SYNC_THROTTLE_MS) {
        return;
      }

      let min = photos[0].capturedAt;
      let max = photos[0].capturedAt;
      for (const p of photos) {
        if (p.capturedAt < min) min = p.capturedAt;
        if (p.capturedAt > max) max = p.capturedAt;
      }
      const timeMin = new Date(min).toISOString();
      const timeMax = new Date(max).toISOString();

      inFlight.current = true;
      setIsSyncing(true);
      setError(null);
      try {
        const base = getProxyUrl();
        const collected: LiveCalendarEvent[] = [];
        let pageToken: string | undefined;

        do {
          const params = new URLSearchParams({ timeMin, timeMax });
          if (pageToken) params.set('pageToken', pageToken);
          const res = await getAuthorizedFetch(`${base}/api/calendar/events?${params.toString()}`);
          if (!res.ok) {
            if (res.status === 401) throw new Error('reauth_required');
            throw new Error(`Calendar sync failed (${res.status})`);
          }
          const data: { items?: GoogleEvent[]; nextPageToken?: string } = await res.json();
          for (const item of data.items ?? []) collected.push(mapEvent(item));
          pageToken = data.nextPageToken;
        } while (pageToken);

        await putCalendarEvents(collected);
        setEvents([...collected].sort(byStartAsc));

        const now = Date.now();
        await setCalendarLastSyncedAt(now);
        setLastSyncedAt(now);
      } catch (e) {
        console.error('[l8rgram] Calendar sync failed', e);
        setError(e instanceof Error ? e.message : 'Calendar sync failed.');
      } finally {
        inFlight.current = false;
        setIsSyncing(false);
      }
    },
    [photos, lastSyncedAt],
  );

  const syncNow = useCallback(() => runSync(true), [runSync]);

  // Automatic, throttled re-sync when the photo span changes — but only after an
  // initial sync has happened (the first fetch is user-triggered via the button).
  const spanKey = photos.length
    ? `${Math.min(...photos.map((p) => p.capturedAt))}-${Math.max(...photos.map((p) => p.capturedAt))}`
    : '';
  useEffect(() => {
    if (lastSyncedAt == null) return;
    if (!spanKey) return;
    void runSync(false);
    // runSync is intentionally omitted: it changes identity on every lastSyncedAt
    // update, which would re-fire this effect immediately after each sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanKey]);

  return { events, isSyncing, lastSyncedAt, error, syncNow };
};
