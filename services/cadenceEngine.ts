/**
 * cadenceEngine.ts
 *
 * Pure functions for deciding which MomentClusters to surface right now.
 * No network calls. Pure date arithmetic.
 */

import {
  MomentCluster,
  MomentType,
  Rhythm,
  ParsedRhythm,
  CadencePattern,
  MomentMeta,
} from '../types';

// --- Lead time defaults by Moment type ---

const LEAD_DAYS: Record<string, number> = {
  itinerary: 14,
  brief: 1,
  dashboard: 7,
  'gift-guide': 7,
  'meal-plan': 7,
  list: 7,
  curriculum: 14,
  general: 7,
};

export function surfaceLeadDays(type: MomentType): number {
  return LEAD_DAYS[type] ?? 7;
}

// --- Default cadences by entity type (no rhythm set) ---

export const DEFAULT_CADENCES: Record<string, CadencePattern> = {
  restaurant: {
    frequency: 'weekly',
    daysOfWeek: [5, 6], // Fri + Sat
    timeOfDay: 'afternoon',
  },
  cafe: {
    frequency: 'weekly',
    daysOfWeek: [5, 6],
    timeOfDay: 'afternoon',
  },
  movie: {
    frequency: 'weekly',
    daysOfWeek: [5, 6],
    timeOfDay: 'evening',
  },
  'tv show': {
    frequency: 'weekly',
    daysOfWeek: [5, 6],
    timeOfDay: 'evening',
  },
  book: {
    frequency: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    timeOfDay: 'morning',
  },
  article: {
    frequency: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5],
    timeOfDay: 'morning',
  },
  recipe: {
    frequency: 'weekly',
    daysOfWeek: [0], // Sunday
    timeOfDay: 'morning',
  },
  product: {
    frequency: 'daily',
    timeOfDay: 'afternoon',
  },
};

// --- Days until a temporal window starts ---

export function daysUntilWindowStart(
  window: { start: string; end?: string },
  now: Date
): number {
  const start = new Date(window.start);
  if (isNaN(start.getTime())) return -1; // Can't parse fuzzy dates
  const diffMs = start.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// --- Matching a rhythm to a cluster ---

export function rhythmMatchesCluster(
  parsed: ParsedRhythm,
  cluster: MomentCluster
): boolean {
  return parsed.matchers.some(matcher => {
    switch (matcher.field) {
      case 'entityType':
        return (
          cluster.clusterCriteria.entityType?.toLowerCase() ===
          matcher.value.toLowerCase()
        );
      case 'tag':
        return cluster.aggregatedTags.some(
          t => t.toLowerCase() === matcher.value.toLowerCase()
        );
      case 'keyword': {
        const haystack = [
          cluster.title,
          ...cluster.aggregatedTags,
          cluster.clusterCriteria.entityType ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(matcher.value.toLowerCase());
      }
      default:
        return false;
    }
  });
}

// --- Surfacing within a cadence window ---

export function shouldSurfaceNow(
  cadence: CadencePattern,
  now: Date
): boolean {
  if (cadence.frequency === 'contextual') return false; // Handled separately

  if (cadence.daysOfWeek && !cadence.daysOfWeek.includes(now.getDay()))
    return false;
  if (cadence.months && !cadence.months.includes(now.getMonth()))
    return false;

  const h = now.getHours();
  switch (cadence.timeOfDay) {
    case 'morning':
      return h >= 6 && h < 12;
    case 'afternoon':
      return h >= 12 && h < 17;
    case 'evening':
      return h >= 17 && h < 21;
    case 'night':
      return h >= 21 || h < 3;
    default:
      return true; // No timeOfDay constraint
  }
}

// --- Dismissal dampening ---

function isDismissed(meta: MomentMeta | undefined): boolean {
  if (!meta) return false;
  // After 3 consecutive dismissals without engagement, demote
  return meta.dismissCount >= 3;
}

// --- Main surfacing decision ---

export function shouldSurface(
  cluster: MomentCluster,
  rhythms: Rhythm[],
  metas: Map<string, MomentMeta>,
  now: Date
): boolean {
  const meta = metas.get(cluster.id);

  // Demoted clusters are not surfaced in the strip
  if (isDismissed(meta)) return false;

  // Calendar-anchored: is the temporal window approaching?
  if (cluster.clusterCriteria.temporalWindow) {
    const daysUntil = daysUntilWindowStart(
      cluster.clusterCriteria.temporalWindow,
      now
    );
    const lead = surfaceLeadDays(cluster.type);
    // Surface if window hasn't passed and within lead time
    // Also surface if we're currently within the window (daysUntil <= 0 but end hasn't passed)
    if (daysUntil >= 0 && daysUntil <= lead) return true;

    // Check if we're within the window (started but not ended)
    if (cluster.clusterCriteria.temporalWindow.end) {
      const endDate = new Date(cluster.clusterCriteria.temporalWindow.end);
      if (!isNaN(endDate.getTime())) {
        const daysPastEnd = Math.ceil(
          (now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysPastEnd <= 7 && daysUntil <= 0) return true; // Still show 7 days after end
      }
    }

    return false;
  }

  // Rhythm-matched
  const activeRhythms = rhythms.filter(r => r.isActive);
  const matchingRhythms = activeRhythms.filter(r =>
    rhythmMatchesCluster(r.parsed, cluster)
  );

  if (matchingRhythms.length > 0) {
    // Apply frequency override
    const override = meta?.frequencyOverride;
    if (override === 'more') {
      // Halve the constraint: always show if any time-of-day matches
      return matchingRhythms.some(r => {
        const cadence = r.parsed.cadence;
        if (cadence.daysOfWeek && !cadence.daysOfWeek.includes(now.getDay()))
          return false;
        return true; // Ignore timeOfDay for "more often"
      });
    }
    if (override === 'less') {
      // Stricter: require both day and time match, plus only even hours
      return (
        now.getHours() % 2 === 0 &&
        matchingRhythms.some(r => shouldSurfaceNow(r.parsed.cadence, now))
      );
    }

    return matchingRhythms.some(r => shouldSurfaceNow(r.parsed.cadence, now));
  }

  // Default cadence by entity type
  const et = cluster.clusterCriteria.entityType?.toLowerCase() ?? '';
  const defaultCadence = DEFAULT_CADENCES[et];
  if (defaultCadence) return shouldSurfaceNow(defaultCadence, now);

  // No rhythm, no temporal window, no default cadence — don't surface
  return false;
}

// --- Ranking surfaced clusters ---

export function rankClusters(
  clusters: MomentCluster[],
  metas: Map<string, MomentMeta>,
  now: Date
): MomentCluster[] {
  return clusters.slice().sort((a, b) => {
    // 1. Deadline-approaching first
    const aDays = a.clusterCriteria.temporalWindow
      ? daysUntilWindowStart(a.clusterCriteria.temporalWindow, now)
      : Infinity;
    const bDays = b.clusterCriteria.temporalWindow
      ? daysUntilWindowStart(b.clusterCriteria.temporalWindow, now)
      : Infinity;
    if (aDays !== bDays) return aDays - bDays;

    // 2. Unseen before seen
    const aViewed = metas.get(a.id)?.lastViewedAt ?? 0;
    const bViewed = metas.get(b.id)?.lastViewedAt ?? 0;
    if (aViewed !== bViewed) return aViewed - bViewed;

    // 3. More notes = more important
    return b.noteIds.length - a.noteIds.length;
  });
}
