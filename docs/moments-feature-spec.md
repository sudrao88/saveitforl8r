# Moments Feature Specification

**Project:** SaveItForL8R
**Feature:** Moments — Proactive synthesis of time-relevant notes
**Status:** Design complete, ready for implementation
**Date:** 2026-02-24

---

## 1. Overview

Moments is a proactive, AI-powered synthesis layer that sits above the existing notes feed. It groups related notes into coherent, time-relevant clusters and surfaces them at the right time — without the user having to ask.

A Moment is not a single note. It is a **synthesised output** derived from a cluster of related notes. Examples:

- A Tokyo trip itinerary built from flights, hotel saves, restaurant bookmarks, and activity notes
- A weekend dining guide assembled from saved restaurants
- A meeting prep brief built from company research and talking points
- A gift list compiled from gift idea notes saved over months

The key architectural principle: **surfacing is deterministic and client-side; synthesis is LLM-powered and on-demand, with local caching.**

---

## 2. Information Architecture

The main feed layout changes from the current two-zone structure to a four-zone structure:

```
┌─────────────────────────────────────────┐
│  ZONE 1: HEADER (sticky)                │
│  Logo · Search · Settings               │
├─────────────────────────────────────────┤
│  ZONE 2: MOMENTS (sticky, below header) │
│  Instagram Stories-style horizontal     │
│  scroll of Moment preview bubbles       │
├─────────────────────────────────────────┤
│  ZONE 3: FILTER BAR (sticky)            │
│  Existing entity-type filter chips      │
├─────────────────────────────────────────┤
│  ZONE 4: NOTES FEED (scrollable)        │
│  Existing masonry grid of memory cards  │
└─────────────────────────────────────────┘
```

### 2.1 Current layout (App.tsx reference)

The current sticky header block at `App.tsx:401` contains:
- `TopNavigation` (logo, search, settings)
- `FilterBar` (entity type chips)

The new layout inserts the Moments strip between `TopNavigation` and `FilterBar` inside the existing sticky container.

### 2.2 Moments Strip — Instagram Stories UI

The Moments strip is a horizontally scrollable row of circular/pill preview bubbles, identical in interaction model to Instagram Stories:

```
┌────────────────────────────────────────────────────────┐
│  ○        ○        ○        ○        ○                 │
│ Tokyo   Weekend  Meeting  Gift     Meal                 │
│  Trip   Dining   Prep     Ideas    Prep                 │
└────────────────────────────────────────────────────────┘
```

**Each bubble:**
- 64×64px circular avatar
- Background: gradient derived from the dominant tag colour or Moment type
- Icon or emoji representing the Moment type (e.g. ✈️ trip, 🍜 dining, 🎬 movies)
- Label below: truncated Moment title (max 10 chars)
- Unviewed state: coloured ring border (blue gradient, same as Instagram)
- Viewed/cached state: grey ring border
- Approaching deadline: pulsing amber ring

**Strip behaviour:**
- Horizontal scroll, no-scrollbar, touch-friendly
- Only surfaced Moments appear here (cadence engine decides)
- "All Moments" overflow button at the right end → opens full Moments sheet
- Hidden entirely if zero Moments are currently surfaced

---

## 3. The `relevantAt` Field

### 3.1 What it is

`relevantAt` is a new optional field on `EnrichmentData` that captures when a note is temporally relevant. It drives the Moments clustering and cadence engine.

### 3.2 Three-layer capture strategy

**Layer 1 — AI inference (primary, zero friction)**

The enrichment prompt is extended to extract `temporalContext` from note content. Most notes contain enough signal:

| User writes | AI infers |
|---|---|
| "Trip to Tokyo in April" | `start: "2026-04"`, `type: "trip"` |
| "Questions for Dr Patel on Thursday" | `start: "2026-02-26"`, `type: "appointment"` |
| "Summer reading list" | `start: "2026-06"`, `end: "2026-08"`, `type: "seasonal"` |
| "Mum's birthday — maybe the ceramic vase" | `isRecurring: true`, `recurrenceRule: "yearly"` |

No user action required. This handles the majority of cases.

**Layer 2 — Optional "When?" input at creation (low friction)**

A collapsed chip row is added to `NewMemoryPage` below the tags section:

```
📅 When?   (collapsed by default, one tap to expand)

Expanded:
📅 When is this relevant?
[ Today ] [ This weekend ] [ Next week ] [ Pick date… ]

Or type: "march", "summer", "mum's birthday"
```

- Collapsed by default — no visual weight unless needed
- Natural language text input — parsed by the enrichment LLM, not a date picker
- Quick-pick chips cover the 80% case with one tap
- Positioned after tags, before save — consistent with progressive disclosure pattern

**Layer 3 — Post-save nudge (safety net, rare)**

If enrichment completes and cannot infer temporal relevance, but the content contains signals like "appointment", "trip", "deadline", "birthday", a subtle dismissible card appears on the memory:

```
┌─ 📅 When will you need this? ─────┐
│  [ Add a date ]    [ Not needed ]  │
└────────────────────────────────────┘
```

Non-blocking. Appears after the modal has closed. Handles the ~5% edge case.

### 3.3 Data model additions

```typescript
// Added to EnrichmentData in types.ts
interface TemporalContext {
  relevantAt?: {
    start: string;            // ISO date or fuzzy ("2026-03", "summer 2026")
    end?: string;             // For ranges (trips, seasons)
    isRecurring?: boolean;    // Birthdays, anniversaries
    recurrenceRule?: string;  // "yearly", "monthly"
  };
  urgency?: 'low' | 'medium' | 'high';
  inferenceConfidence: number;  // 0–1; below 0.5 triggers Layer 3 nudge
}

// EnrichmentData gains one new optional field:
interface EnrichmentData {
  // ... existing fields unchanged ...
  temporalContext?: TemporalContext;  // NEW
}
```

---

## 4. Rhythms

Rhythms are the user's lifestyle patterns. They map recurring content clusters to the right surfacing cadence. Declared once in natural language; never need reconfiguring.

### 4.1 User experience

Located in Settings → Rhythms:

```
┌─ Your Rhythms ──────────────────────────────┐
│                                              │
│  🍜  "I try new restaurants on weekends"     │
│      Weekend Dining · Fri afternoons    [×]  │
│                                              │
│  🎬  "I watch shows most evenings after 8"   │
│      Evening Watch List · Daily 8pm     [×]  │
│                                              │
│  📚  "I read during my commute"              │
│      Commute Reading · Weekday mornings [×]  │
│                                              │
│  [ + Add a rhythm ]                          │
│                                              │
│  These help surface the right Moments at     │
│  the right time. Change them anytime.        │
└──────────────────────────────────────────────┘
```

### 4.2 Parsing — one LLM call at creation time

When a user types a rhythm and taps save, the client calls `POST /api/parse-rhythm`. The LLM returns structured data that is stored locally. This is the **only** LLM call associated with a Rhythm — never at surfacing time.

**Request:**
```json
{
  "text": "I try new restaurants on weekends, usually Saturday lunch",
  "existingTags": ["date night", "Tokyo trip", "healthy eating"],
  "existingEntityTypes": ["Restaurant", "Movie", "Book"]
}
```

**Response:**
```json
{
  "matchers": [
    { "field": "entityType", "value": "Restaurant" },
    { "field": "keyword",    "value": "cafe" },
    { "field": "keyword",    "value": "dining" }
  ],
  "cadence": {
    "frequency": "weekly",
    "daysOfWeek": [6],
    "timeOfDay": "morning",
    "surfaceOffsetHours": 18
  },
  "inferredLabel": "Weekend Dining"
}
```

`existingTags` and `existingEntityTypes` are sent so the LLM produces matchers that align with the user's actual data.

### 4.3 Parsing examples

| Natural language | Parsed cadence | Matcher fields |
|---|---|---|
| "I try restaurants on weekends" | weekly, Sat/Sun, afternoon, offset 18h | entityType:Restaurant, keyword:cafe |
| "I watch shows most evenings after 8" | daily, all days, night, offset 2h | entityType:Movie, keyword:tv, keyword:show |
| "I meal prep on Sundays" | weekly, Sun, morning, offset 12h | keyword:recipe, keyword:meal, tag:recipe |
| "I read during my commute" | daily, Mon–Fri, morning, offset 1h | entityType:Book, keyword:article |
| "I go to restaurants when travelling" | contextual — activates when trip cluster is approaching | entityType:Restaurant, contextTrigger:tag:trip |

### 4.4 Data model

```typescript
interface Rhythm {
  id: string;
  natural: string;           // Original text as typed by user
  parsed: ParsedRhythm;      // LLM output, stored at creation time
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

interface ParsedRhythm {
  matchers: RhythmMatcher[];
  cadence: CadencePattern;
  inferredLabel: string;     // Display name, e.g. "Weekend Dining"
}

interface RhythmMatcher {
  field: 'entityType' | 'tag' | 'keyword';
  value: string;
}

interface CadencePattern {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'contextual';
  daysOfWeek?: number[];          // 0=Sun … 6=Sat
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  surfaceOffsetHours?: number;    // Surface this far in advance of target time
  months?: number[];              // 0=Jan … 11=Dec, for seasonal
  contextTrigger?: {
    type: 'co-occurrence';
    withClusterTag?: string;      // Activate only when a trip cluster is approaching
  };
}
```

Stored in IndexedDB alongside memories. Encrypted with AES-GCM. Synced to Google Drive.

### 4.5 Rhythm conflicts

If two rhythms match the same cluster with different cadences, the engine takes the **union** — surface if any matching rhythm is active:

```typescript
function getEffectiveSurface(cluster: MomentCluster, rhythms: Rhythm[]): boolean {
  const matching = rhythms.filter(r => rhythmMatchesCluster(r.parsed, cluster));
  return matching.some(r => shouldSurfaceNow(r.parsed.cadence, new Date()));
}
```

---

## 5. Client-Side Clustering Engine

Runs locally on every app open and whenever notes change. Pure TypeScript. No network calls. Target: completes in < 50ms.

### 5.1 Cluster types (priority order)

1. **Compound** (highest priority): tag + entityType, or tag + temporalWindow
   → "Tokyo Trip — Restaurants"
2. **Tag**: all notes sharing a user or AI-suggested tag
   → "Tokyo Trip"
3. **Temporal**: all notes with `relevantAt` falling in the same window
   → "Coming Up This Weekend"
4. **Entity type** (lowest priority): all notes of the same entity type
   → "Restaurant Picks"

A note belongs to the highest-priority cluster it qualifies for. Compound clusters absorb their component parents — notes in "Tokyo Restaurants" do not inflate the generic "Restaurants" cluster.

Minimum cluster size: **2 notes**.

### 5.2 Cluster data model

```typescript
interface MomentCluster {
  id: string;                  // Deterministic: sha256 of cluster criteria JSON
  title: string;               // Derived (see 5.3)
  type: MomentType;            // Determines synthesis template
  clusterCriteria: {
    entityType?: string;
    tag?: string;
    temporalWindow?: { start: string; end: string };
  };
  noteIds: string[];
  aggregatedTags: string[];    // Union of all tags across member notes
  inputHash: string;           // sha256(sorted noteIds + their timestamps)
}

type MomentType =
  | 'itinerary'     // Trip or event with temporal window
  | 'brief'         // Meeting/interview prep
  | 'list'          // Restaurant, movie, book, shopping picks
  | 'dashboard'     // Event planning (venue + tasks + budget)
  | 'curriculum'    // Learning path
  | 'gift-guide'    // Gift ideas for a person/occasion
  | 'meal-plan'     // Recipes + meal prep
  | 'general';      // Fallback
```

### 5.3 Title derivation (no LLM)

```typescript
function deriveTitle(criteria: ClusterCriteria): string {
  if (criteria.tag && criteria.entityType)
    return `${criteria.tag} — ${criteria.entityType}s`;      // "Tokyo Trip — Restaurants"
  if (criteria.tag)
    return criteria.tag;                                      // "Tokyo Trip"
  if (criteria.entityType)
    return `${criteria.entityType} Picks`;                   // "Restaurant Picks"
  if (criteria.temporalWindow)
    return `Coming Up ${formatWindow(criteria.temporalWindow)}`; // "Coming Up This Weekend"
  return 'Moment';
}
```

### 5.4 MomentType detection (no LLM)

```typescript
function detectMomentType(cluster: MomentCluster): MomentType {
  if (cluster.clusterCriteria.temporalWindow) return 'itinerary';
  const et = cluster.clusterCriteria.entityType?.toLowerCase() ?? '';
  if (['restaurant', 'cafe', 'place'].some(k => et.includes(k))) return 'list';
  if (['movie', 'tv show', 'book', 'music'].some(k => et.includes(k))) return 'list';
  if (cluster.aggregatedTags.some(t => ['recipe', 'meal', 'cooking'].includes(t))) return 'meal-plan';
  if (cluster.aggregatedTags.some(t => ['gift', 'birthday', 'anniversary'].includes(t))) return 'gift-guide';
  if (cluster.aggregatedTags.some(t => ['course', 'learn', 'study'].includes(t))) return 'curriculum';
  return 'general';
}
```

---

## 6. Client-Side Cadence Engine

Decides which clusters to surface right now. No network. Pure date arithmetic.

```typescript
function shouldSurface(cluster: MomentCluster, rhythms: Rhythm[], now: Date): boolean {
  // Calendar-anchored: is the temporal window approaching?
  if (cluster.clusterCriteria.temporalWindow) {
    const daysUntil = daysUntilWindowStart(cluster.clusterCriteria.temporalWindow, now);
    return daysUntil >= 0 && daysUntil <= surfaceLeadDays(cluster.type);
  }

  // Rhythm-matched
  const matchingRhythms = rhythms.filter(r =>
    r.isActive && rhythmMatchesCluster(r.parsed, cluster)
  );
  if (matchingRhythms.length > 0) {
    return matchingRhythms.some(r => shouldSurfaceNow(r.parsed.cadence, now));
  }

  // Default cadence by entity type
  const defaultCadence = DEFAULT_CADENCES[cluster.clusterCriteria.entityType ?? ''];
  if (defaultCadence) return shouldSurfaceNow(defaultCadence, now);

  return false;
}
```

### 6.1 Lead time defaults by Moment type

| Moment type | Surface lead time |
|---|---|
| Trip / itinerary | 14 days before start |
| Appointment / meeting | 1 day before |
| Event (party, concert) | 7 days before |
| Seasonal (summer, holidays) | 14 days before season start |

### 6.2 Default cadences by entity type (no rhythm set)

| Entity type | Default days | Default time | Rationale |
|---|---|---|---|
| Restaurant / Cafe | Fri + Sat | Afternoon | Weekend dining |
| Movie / TV Show | Fri + Sat | Evening | Weekend watching |
| Book / Article | Mon–Fri | Morning | Commute reading |
| Recipe | Sun | Morning | Meal prep |
| Product / Shopping | Any | Afternoon | Browsing |

### 6.3 Matching a rhythm to a cluster

```typescript
function rhythmMatchesCluster(parsed: ParsedRhythm, cluster: MomentCluster): boolean {
  return parsed.matchers.some(matcher => {
    switch (matcher.field) {
      case 'entityType':
        return cluster.clusterCriteria.entityType === matcher.value;
      case 'tag':
        return cluster.aggregatedTags.includes(matcher.value);
      case 'keyword':
        const haystack = [
          cluster.title,
          ...cluster.aggregatedTags,
          cluster.clusterCriteria.entityType ?? ''
        ].join(' ').toLowerCase();
        return haystack.includes(matcher.value.toLowerCase());
    }
  });
}
```

### 6.4 Surfacing within a cadence window

```typescript
function shouldSurfaceNow(cadence: CadencePattern, now: Date): boolean {
  if (cadence.frequency === 'contextual') return false; // handled separately

  if (cadence.daysOfWeek && !cadence.daysOfWeek.includes(now.getDay())) return false;
  if (cadence.months && !cadence.months.includes(now.getMonth())) return false;

  const h = now.getHours();
  switch (cadence.timeOfDay) {
    case 'morning':   return h >= 6  && h < 12;
    case 'afternoon': return h >= 12 && h < 17;
    case 'evening':   return h >= 17 && h < 21;
    case 'night':     return h >= 21 || h < 3;
  }
  return true;
}
```

---

## 7. Moment Surfacing — Stories UI Interaction

### 7.1 Preview bubbles (no LLM)

Each bubble in the strip shows metadata only — no synthesis needed:

```
[✈️ ring]   [🍜 ring]   [🎬 grey]
Tokyo Trip  Wknd Dining  Watch List
38 days     5 notes      12 notes
```

The ring colour indicates state:
- **Blue gradient ring** = unseen or updated since last view
- **Grey ring** = seen, synthesis up to date (inputHash unchanged)
- **Amber pulsing ring** = approaching deadline (< 7 days)

Tapping a bubble opens the Moment detail sheet.

### 7.2 Moment detail sheet (LLM on tap)

Opens as a bottom sheet / full-screen modal. On open:

```typescript
async function onMomentTap(cluster: MomentCluster): Promise<void> {
  const currentHash = computeInputHash(cluster.noteIds, memories);
  const cached = await getCachedSynthesis(cluster.id);

  if (cached && cached.inputHash === currentHash) {
    displaySynthesis(cached);    // Instant — no spinner, no network
    return;
  }

  showSynthesisLoading(cluster); // Skeleton UI

  const notes = cluster.noteIds.map(id => getDecryptedMemory(id));
  const synthesis = await callSynthesizeAPI(notes, cluster);

  await storeSynthesis({
    momentId: cluster.id,
    inputHash: currentHash,
    content: synthesis.content,
    format: synthesis.format,
    generatedAt: Date.now(),
  });

  displaySynthesis(synthesis);
}
```

### 7.3 Cache invalidation

```typescript
function computeInputHash(noteIds: string[], memories: Memory[]): string {
  const inputs = noteIds
    .sort()
    .map(id => {
      const m = memories.find(n => n.id === id)!;
      return `${id}:${m.timestamp}`;   // timestamp updates on every edit
    })
    .join('|');
  return sha256(inputs);
}
```

The hash changes when any of the following occur:
- A note is added to the cluster
- A note in the cluster is edited
- A note is deleted from the cluster
- A note is marked as visited/completed within the Moment

If the hash matches the cached synthesis, **no LLM call is made**.

---

## 8. LLM Synthesis

### 8.1 New endpoint: `POST /api/synthesize`

Follows the same auth, validation, and rate-limiting patterns as `/api/enrich` and `/api/query`.

**Rate limit:** 10 requests/min per user (same as `/api/query`).

**Request:**
```json
{
  "notes": [
    {
      "id": "abc123",
      "content": "...",
      "tags": ["Tokyo trip", "restaurant"],
      "enrichment": { "summary": "...", "locationContext": {...}, "temporalContext": {...} }
    }
  ],
  "momentType": "itinerary",
  "momentTitle": "Tokyo Trip",
  "temporalWindow": { "start": "2026-04-01", "end": "2026-04-10" }
}
```

**System prompt (abbreviated):**

> You are a synthesis engine for a personal second-brain app. Given a set of related notes, produce a coherent, actionable `{momentType}`. The output should be practically useful — something the user can act on immediately. Format: structured JSON matching the synthesis schema below. Do not add information not present in the notes. Do not hallucinate details.

**Response schema (varies by `momentType`):**

```typescript
interface SynthesisResponse {
  format: MomentType;
  title: string;
  subtitle?: string;           // e.g. "April 1–10 · 10 days"
  sections: SynthesisSection[];
  generatedFrom: string[];     // Note IDs used
}

interface SynthesisSection {
  heading: string;             // e.g. "Day 1 — Tokyo Arrival"
  items: SynthesisItem[];
}

interface SynthesisItem {
  label: string;               // e.g. "Dinner: Ichiran Ramen Shibuya"
  detail?: string;             // e.g. "Open until 11pm · ¥1,200/person"
  link?: string;               // Maps URI or website from enrichment
  sourceNoteId: string;        // Which note this came from
  completable?: boolean;       // Can be checked off (visited, watched, etc.)
  completed?: boolean;         // User has marked done
}
```

### 8.2 Synthesis formats by Moment type

| Type | Output structure | Example heading |
|---|---|---|
| `itinerary` | Sections = days | "Day 1 — Arrival", "Day 2 — Shibuya" |
| `brief` | Sections = topics | "Company Background", "Questions to Ask" |
| `list` | Sections = categories | "Italian", "Japanese", "Brunch" |
| `dashboard` | Sections = workstreams | "Venue", "Catering", "Guest List" |
| `curriculum` | Sections = modules | "Foundations", "Projects", "Resources" |
| `gift-guide` | Sections = recipients or price bands | "Under £30", "Splurge" |
| `meal-plan` | Sections = days or meals | "Sunday Prep", "Monday Dinner" |
| `general` | Sections = themes | AI-determined |

---

## 9. Moment Persistence

### 9.1 Cached synthesis

```typescript
interface MomentSynthesis {
  momentId: string;
  inputHash: string;
  content: SynthesisResponse;
  generatedAt: number;
  noteIds: string[];           // Snapshot of which notes were included
}
```

Stored in IndexedDB. Encrypted with AES-GCM. Synced to Google Drive.

### 9.2 Moment metadata (interaction state)

```typescript
interface MomentMeta {
  momentId: string;
  lastSurfacedAt?: number;
  lastViewedAt?: number;
  dismissCount: number;
  frequencyOverride?: 'more' | 'less' | null;
  completedNoteIds: string[];  // Notes marked visited/watched/read
}
```

Persisted in IndexedDB. Survives cluster recomputation. The `momentId` is deterministic (hash of cluster criteria), so `MomentMeta` maps stably even as note membership evolves.

---

## 10. Inline Feedback

Within an open Moment synthesis, a subtle control row appears:

```
⏰ Show me this:
[ More often ]  [ Less often ]  [ Not now ]
```

- **More often** → sets `frequencyOverride: 'more'` on `MomentMeta`, cadence engine halves the inter-surface gap
- **Less often** → sets `frequencyOverride: 'less'`, doubles the gap
- **Not now** → dismisses for the current cadence window; increments `dismissCount`

After 3 consecutive dismissals without any engagement, a Moment is moved from the surfaced strip to "All Moments" (not deleted, just demoted).

---

## 11. Moment Lifecycle

```
APP OPENS
    ↓
Load memories + MomentMeta + Rhythms from IndexedDB
    ↓
CLUSTERING ENGINE (~ms, sync)
  • Group notes by tag, entityType, temporalWindow
  • Exclude completedNoteIds from MomentMeta
  • Compute inputHash per cluster
    ↓
CADENCE ENGINE (~ms, sync)
  • Match clusters to Rhythms (or defaults)
  • Filter: shouldSurface(cluster, rhythms, now)?
  • Apply dismissal dampening from MomentMeta
  • Rank: deadline-approaching > rhythm-match > note-count
    ↓
RENDER STORIES STRIP (instant, no loading state)
  • Show surfaced Moment bubbles
  • Ring colour = viewed/unviewed/urgent
    ↓
USER TAPS BUBBLE
  • Compute inputHash
  • Cache hit → display instantly
  • Cache miss → skeleton → POST /api/synthesize → store → display
    ↓
USER INTERACTS WITH SYNTHESIS
  • Mark item complete → update note metadata → hash changes
  • Tap "More/Less often" → update MomentMeta
  • Dismiss → increment dismissCount
    ↓
NEXT APP OPEN → cycle repeats
```

---

## 12. Recurring Moment Types

Three distinct recurrence categories:

**A. Calendar-anchored (finite)**
Driven by `temporalContext.relevantAt`. Surfaces with lead time, intensifies as date approaches, archives after. Example: Tokyo trip, job interview.

**B. Lifestyle-anchored (infinite, periodic)**
Driven by Rhythms. Never ends — cluster evolves as notes are added/completed. Example: weekend restaurants, evening watch list.

**C. Context-anchored (aperiodic)**
No fixed schedule. Uses `contextTrigger` in `CadencePattern`. Activates when a related calendar-anchored Moment is approaching (e.g. "Travel Dining" activates only when a trip cluster is active). For v1, these can be surfaced on-demand via "All Moments" only.

---

## 13. Moment Examples

| Moment | Notes collected | Synthesis output |
|---|---|---|
| Tokyo Trip | Flights, hotel, 6 restaurant saves, TeamLab tickets, packing list | Day-by-day itinerary with map links, reservations, activity slots |
| Weekend Dining | 5 saved restaurants across 3 months | Categorised list with cuisine, price, hours, map links |
| Interview Prep — Acme Corp | Company research, CEO background, salary data, question list | One-page brief: company overview, talking points, questions by topic |
| Mum's Birthday | 3 gift ideas, size/colour notes, "NOT the blue one" | Gift guide with items, links, prices, and constraint notes |
| Sunday Meal Prep | 4 recipe saves, "Jake is gluten-free", shopping reminders | Menu plan, consolidated shopping list, dietary flags, prep order |
| New Flat Move | Apartment listings, neighbourhood notes, utility providers, moving quotes | Comparison matrix, ranked options, moving checklist |
| Evening Watch List | 12 movies and shows saved over months | Categorised queue by genre/mood with ratings and runtimes |
| Learn TypeScript | Course bookmarks, tutorial notes, "project idea: rebuild todo app" | Ordered curriculum with resources, estimated hours, project milestones |
| Date Night | Restaurant saves, "jazz bar Soho", "farmer's market Saturday AM" | Plan with timing, reservation prompts, directions |

---

## 14. New API Endpoints

### `POST /api/parse-rhythm`

Parses a natural language rhythm description into structured data.

- **Auth:** Bearer token (same as existing endpoints)
- **Rate limit:** 5 req/min per user (infrequent action)
- **Request body:**
  ```json
  {
    "text": "string (max 500 chars)",
    "existingTags": ["string"],
    "existingEntityTypes": ["string"]
  }
  ```
- **Response:** `ParsedRhythm` (see §4.4)
- **Called:** Once when user creates or edits a Rhythm. Never at surfacing time.

### `POST /api/synthesize`

Synthesises a set of notes into a structured Moment.

- **Auth:** Bearer token
- **Rate limit:** 10 req/min per user
- **Request body:**
  ```json
  {
    "notes": "Memory[] (max 50 notes, same Memory type as /api/query)",
    "momentType": "MomentType string",
    "momentTitle": "string",
    "temporalWindow": "{ start: string, end?: string } | null"
  }
  ```
- **Response:** `SynthesisResponse` (see §8.1)
- **Called:** Only when user taps a Moment bubble AND the inputHash has changed.

---

## 15. Changes to Existing Types

```typescript
// types.ts additions

// Add to EnrichmentData:
temporalContext?: TemporalContext;

// New interfaces:
interface TemporalContext {
  relevantAt?: {
    start: string;
    end?: string;
    isRecurring?: boolean;
    recurrenceRule?: string;
  };
  urgency?: 'low' | 'medium' | 'high';
  inferenceConfidence: number;
}

interface Rhythm {
  id: string;
  natural: string;
  parsed: ParsedRhythm;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

interface ParsedRhythm {
  matchers: RhythmMatcher[];
  cadence: CadencePattern;
  inferredLabel: string;
}

interface RhythmMatcher {
  field: 'entityType' | 'tag' | 'keyword';
  value: string;
}

interface CadencePattern {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'contextual';
  daysOfWeek?: number[];
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  surfaceOffsetHours?: number;
  months?: number[];
  contextTrigger?: { type: 'co-occurrence'; withClusterTag?: string; };
}

interface MomentCluster {
  id: string;
  title: string;
  type: MomentType;
  clusterCriteria: {
    entityType?: string;
    tag?: string;
    temporalWindow?: { start: string; end: string };
  };
  noteIds: string[];
  aggregatedTags: string[];
  inputHash: string;
}

type MomentType =
  | 'itinerary' | 'brief' | 'list' | 'dashboard'
  | 'curriculum' | 'gift-guide' | 'meal-plan' | 'general';

interface MomentSynthesis {
  momentId: string;
  inputHash: string;
  content: SynthesisResponse;
  generatedAt: number;
  noteIds: string[];
}

interface MomentMeta {
  momentId: string;
  lastSurfacedAt?: number;
  lastViewedAt?: number;
  dismissCount: number;
  frequencyOverride?: 'more' | 'less' | null;
  completedNoteIds: string[];
}

interface SynthesisResponse {
  format: MomentType;
  title: string;
  subtitle?: string;
  sections: SynthesisSection[];
  generatedFrom: string[];
}

interface SynthesisSection {
  heading: string;
  items: SynthesisItem[];
}

interface SynthesisItem {
  label: string;
  detail?: string;
  link?: string;
  sourceNoteId: string;
  completable?: boolean;
  completed?: boolean;
}
```

---

## 16. Changes to Existing Files

| File | Change |
|---|---|
| `types.ts` | Add all new interfaces listed in §15 |
| `App.tsx` | Insert `MomentsStrip` component between `TopNavigation` and `FilterBar` in the sticky header block |
| `components/TopNavigation.tsx` | No change |
| `components/FilterBar.tsx` | No change |
| `components/NewMemoryPage.tsx` | Add collapsed "When?" chip row below tags section |
| `server/index.js` | Add `POST /api/parse-rhythm` and `POST /api/synthesize` endpoints |
| `hooks/useMemories.ts` | Expose `rhythms`, `momentMeta`, `momentSyntheses` from IndexedDB |
| `services/storageService.ts` | Add IndexedDB stores for `rhythms`, `momentMeta`, `momentSyntheses` |

### New files

| File | Purpose |
|---|---|
| `components/MomentsStrip.tsx` | Stories-style horizontal strip component |
| `components/MomentBubble.tsx` | Individual story bubble |
| `components/MomentSheet.tsx` | Full-screen synthesis detail sheet |
| `hooks/useMoments.ts` | Clustering engine + cadence engine + synthesis cache |
| `services/clusteringEngine.ts` | Pure functions: buildClusters(), detectMomentType(), computeInputHash() |
| `services/cadenceEngine.ts` | Pure functions: shouldSurface(), rhythmMatchesCluster(), shouldSurfaceNow() |

---

## 17. LLM Call Budget Summary

| Action | LLM call? | Frequency |
|---|---|---|
| Open app, see Moment bubbles | No | Every open |
| Tap Moment (cache hit) | No | Most taps |
| Tap Moment (cache miss / stale) | Yes — 1 call | First tap or after notes change |
| Save a new note | Yes — 1 call (enrichment, already exists) | Per note |
| Create or edit a Rhythm | Yes — 1 call (parse-rhythm) | Rare |
| Dismiss, frequency feedback | No | As needed |

The total new LLM cost introduced by Moments is:
- `1 call per rhythm created` (one-time per rhythm, rare)
- `1 call per Moment tap when inputs have changed` (user-initiated, bounded by synthesis cache)

---

## 18. Open Questions (deferred to implementation)

1. **"All Moments" sheet** — full list of non-surfaced clusters; design not specified here.
2. **Moment archival** — when should calendar-anchored Moments (e.g. past trips) move out of the strip? Suggested: 7 days after `temporalWindow.end`.
3. **Synthesis error handling** — what to show if `/api/synthesize` fails? Suggest: error state within sheet, retry button, strip bubble keeps grey ring.
4. **Offline behaviour** — synthesis not available offline; show cached synthesis if available, else show note list without synthesis.
5. **Drive sync for synthesis** — synthesis cache is large (structured JSON). Decision needed: sync to Drive or treat as local-only derived data that gets regenerated.
6. **Onboarding** — first-time experience to explain Moments and prompt Rhythm setup.
