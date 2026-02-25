/**
 * clusteringEngine.ts
 *
 * Pure functions for grouping notes into MomentClusters.
 * Runs locally on every app open. No network calls. Target: < 50ms.
 */

import { Memory, MomentCluster, MomentType, MomentMeta } from '../types';

// --- Hashing ---

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Synchronous fast hash for deterministic IDs (djb2)
function fastHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return 'mc_' + (hash >>> 0).toString(16);
}

// --- Input Hash ---

export function computeInputHash(noteIds: string[], memories: Memory[]): string {
  const inputs = noteIds
    .slice()
    .sort()
    .map(id => {
      const m = memories.find(n => n.id === id);
      return m ? `${id}:${m.timestamp}` : id;
    })
    .join('|');
  // Use synchronous hash for speed; the hash is only used for cache invalidation comparison
  return fastHash(inputs);
}

// --- Title Derivation (no LLM) ---

function formatWindow(window: { start: string; end: string }): string {
  const now = new Date();
  const start = new Date(window.start);
  const diffDays = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Now';
  if (diffDays <= 2) return 'Tomorrow';
  if (diffDays <= 7) return 'This Week';
  if (diffDays <= 14) return 'Next Week';
  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function deriveTitle(criteria: MomentCluster['clusterCriteria']): string {
  if (criteria.tag && criteria.entityType)
    return `${criteria.tag} — ${criteria.entityType}s`;
  if (criteria.tag)
    return criteria.tag;
  if (criteria.entityType)
    return `${criteria.entityType} Picks`;
  if (criteria.temporalWindow)
    return `Coming Up ${formatWindow(criteria.temporalWindow)}`;
  return 'Moment';
}

// --- MomentType Detection (no LLM) ---

export function detectMomentType(cluster: MomentCluster): MomentType {
  if (cluster.clusterCriteria.temporalWindow) return 'itinerary';
  const et = cluster.clusterCriteria.entityType?.toLowerCase() ?? '';
  if (['restaurant', 'cafe', 'place'].some(k => et.includes(k))) return 'list';
  if (['movie', 'tv show', 'book', 'music'].some(k => et.includes(k))) return 'list';
  if (cluster.aggregatedTags.some(t => ['recipe', 'meal', 'cooking'].includes(t.toLowerCase()))) return 'meal-plan';
  if (cluster.aggregatedTags.some(t => ['gift', 'birthday', 'anniversary'].includes(t.toLowerCase()))) return 'gift-guide';
  if (cluster.aggregatedTags.some(t => ['course', 'learn', 'study'].includes(t.toLowerCase()))) return 'curriculum';
  if (cluster.aggregatedTags.some(t => ['meeting', 'interview', 'prep'].includes(t.toLowerCase()))) return 'brief';
  return 'general';
}

// --- Temporal Window Extraction ---

interface TemporalWindow {
  start: string;
  end: string;
}

function getTemporalWindow(memory: Memory): TemporalWindow | null {
  const tc = memory.enrichment?.temporalContext;
  if (!tc?.relevantAt?.start) return null;

  const start = tc.relevantAt.start;
  const end = tc.relevantAt.end || start;
  return { start, end };
}

/** Bucket a temporal window into a week-granularity key for grouping */
function temporalBucketKey(window: TemporalWindow): string {
  // Normalize to ISO week start
  const d = new Date(window.start);
  if (isNaN(d.getTime())) return window.start; // Fuzzy date, use as-is
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  return weekStart.toISOString().slice(0, 10);
}

// --- Main Clustering Engine ---

export function buildClusters(
  memories: Memory[],
  momentMetas: MomentMeta[]
): MomentCluster[] {
  const activeMemories = memories.filter(
    m => !m.isDeleted && !m.isPending && !m.processingError && !m.isSample
  );

  // Build a set of completed note IDs from all MomentMeta
  const completedNoteIds = new Set<string>();
  for (const meta of momentMetas) {
    for (const id of meta.completedNoteIds) {
      completedNoteIds.add(id);
    }
  }

  // Assign notes to the highest-priority cluster they qualify for.
  // Track which notes have been assigned to compound clusters
  // to prevent them from inflating lower-priority clusters.
  const assignedToCompound = new Set<string>();

  // Intermediate maps
  const tagMap = new Map<string, Memory[]>();
  const entityMap = new Map<string, Memory[]>();
  const temporalMap = new Map<string, { window: TemporalWindow; memories: Memory[] }>();

  for (const mem of activeMemories) {
    // Skip completed notes
    if (completedNoteIds.has(mem.id)) continue;

    // Collect tags
    for (const tag of mem.tags) {
      const key = tag.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key)!.push(mem);
    }

    // Collect entity types
    const et = mem.enrichment?.entityContext?.type;
    if (et) {
      const key = et.toLowerCase();
      if (!entityMap.has(key)) entityMap.set(key, []);
      entityMap.get(key)!.push(mem);
    }

    // Collect temporal windows
    const tw = getTemporalWindow(mem);
    if (tw) {
      const key = temporalBucketKey(tw);
      if (!temporalMap.has(key)) temporalMap.set(key, { window: tw, memories: [] });
      temporalMap.get(key)!.memories.push(mem);
    }
  }

  const clusters: MomentCluster[] = [];

  // Priority 1: Compound clusters (tag + entityType)
  for (const [tagKey, tagMemories] of tagMap) {
    // For each tag, check if there's an entity type subgroup
    const entityGroups = new Map<string, Memory[]>();
    for (const mem of tagMemories) {
      const et = mem.enrichment?.entityContext?.type;
      if (et) {
        const etKey = et.toLowerCase();
        if (!entityGroups.has(etKey)) entityGroups.set(etKey, []);
        entityGroups.get(etKey)!.push(mem);
      }
    }

    for (const [etKey, mems] of entityGroups) {
      if (mems.length < 2) continue;
      const noteIds = mems.map(m => m.id);
      // Use the original casing from first occurrence
      const originalTag = mems[0].tags.find(t => t.toLowerCase() === tagKey) || tagKey;
      const originalEt = mems[0].enrichment?.entityContext?.type || etKey;
      const criteria = { tag: originalTag, entityType: originalEt };
      const criteriaJson = JSON.stringify(criteria);
      const id = fastHash(criteriaJson);
      const aggregatedTags = [...new Set(mems.flatMap(m => m.tags))];

      const cluster: MomentCluster = {
        id,
        title: deriveTitle(criteria),
        type: 'general', // Will be set by detectMomentType
        clusterCriteria: criteria,
        noteIds,
        aggregatedTags,
        inputHash: computeInputHash(noteIds, memories),
      };
      cluster.type = detectMomentType(cluster);
      clusters.push(cluster);

      for (const nid of noteIds) assignedToCompound.add(nid);
    }
  }

  // Priority 1b: Compound clusters (tag + temporalWindow)
  for (const [tagKey, tagMemories] of tagMap) {
    const temporalMems = tagMemories.filter(m => {
      if (assignedToCompound.has(m.id)) return false;
      return getTemporalWindow(m) !== null;
    });

    if (temporalMems.length < 2) continue;

    // Group by temporal bucket
    const bucketGroups = new Map<string, { window: TemporalWindow; mems: Memory[] }>();
    for (const mem of temporalMems) {
      const tw = getTemporalWindow(mem)!;
      const key = temporalBucketKey(tw);
      if (!bucketGroups.has(key)) bucketGroups.set(key, { window: tw, mems: [] });
      bucketGroups.get(key)!.mems.push(mem);
    }

    for (const [, { window, mems }] of bucketGroups) {
      if (mems.length < 2) continue;
      const noteIds = mems.map(m => m.id);
      const originalTag = mems[0].tags.find(t => t.toLowerCase() === tagKey) || tagKey;
      const criteria = { tag: originalTag, temporalWindow: window };
      const criteriaJson = JSON.stringify(criteria);
      const id = fastHash(criteriaJson);
      const aggregatedTags = [...new Set(mems.flatMap(m => m.tags))];

      const cluster: MomentCluster = {
        id,
        title: deriveTitle(criteria),
        type: 'general',
        clusterCriteria: criteria,
        noteIds,
        aggregatedTags,
        inputHash: computeInputHash(noteIds, memories),
      };
      cluster.type = detectMomentType(cluster);
      clusters.push(cluster);

      for (const nid of noteIds) assignedToCompound.add(nid);
    }
  }

  // Priority 2: Tag clusters
  for (const [tagKey, tagMemories] of tagMap) {
    const unassigned = tagMemories.filter(m => !assignedToCompound.has(m.id));
    if (unassigned.length < 2) continue;

    const noteIds = unassigned.map(m => m.id);
    const originalTag = unassigned[0].tags.find(t => t.toLowerCase() === tagKey) || tagKey;
    const criteria = { tag: originalTag };
    const criteriaJson = JSON.stringify(criteria);
    const id = fastHash(criteriaJson);
    const aggregatedTags = [...new Set(unassigned.flatMap(m => m.tags))];

    const cluster: MomentCluster = {
      id,
      title: deriveTitle(criteria),
      type: 'general',
      clusterCriteria: criteria,
      noteIds,
      aggregatedTags,
      inputHash: computeInputHash(noteIds, memories),
    };
    cluster.type = detectMomentType(cluster);
    clusters.push(cluster);
  }

  // Priority 3: Temporal clusters (notes with relevantAt in same window, not already in compound)
  for (const [, { window, memories: tMems }] of temporalMap) {
    const unassigned = tMems.filter(m => !assignedToCompound.has(m.id));
    if (unassigned.length < 2) continue;

    const noteIds = unassigned.map(m => m.id);
    const criteria = { temporalWindow: window };
    const criteriaJson = JSON.stringify(criteria);
    const id = fastHash(criteriaJson);
    const aggregatedTags = [...new Set(unassigned.flatMap(m => m.tags))];

    const cluster: MomentCluster = {
      id,
      title: deriveTitle(criteria),
      type: 'itinerary',
      clusterCriteria: criteria,
      noteIds,
      aggregatedTags,
      inputHash: computeInputHash(noteIds, memories),
    };
    clusters.push(cluster);
  }

  // Priority 4: Entity type clusters (lowest priority)
  for (const [etKey, etMemories] of entityMap) {
    const unassigned = etMemories.filter(m => !assignedToCompound.has(m.id));
    if (unassigned.length < 2) continue;

    const noteIds = unassigned.map(m => m.id);
    const originalEt = unassigned[0].enrichment?.entityContext?.type || etKey;
    const criteria = { entityType: originalEt };
    const criteriaJson = JSON.stringify(criteria);
    const id = fastHash(criteriaJson);
    const aggregatedTags = [...new Set(unassigned.flatMap(m => m.tags))];

    const cluster: MomentCluster = {
      id,
      title: deriveTitle(criteria),
      type: 'general',
      clusterCriteria: criteria,
      noteIds,
      aggregatedTags,
      inputHash: computeInputHash(noteIds, memories),
    };
    cluster.type = detectMomentType(cluster);
    clusters.push(cluster);
  }

  return clusters;
}
