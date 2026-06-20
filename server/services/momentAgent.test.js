/**
 * Tests for the agentic moment-creation loop (server/services/momentAgent.js).
 * The Gemini client is fully mocked: orchestrator turns return scripted
 * functionCalls; the nested web_search sub-call (config.tools[0].googleSearch)
 * returns grounded chunks; embedContent returns fake vectors.
 */
import { describe, it, expect, vi } from 'vitest';
import { runMomentAgent } from './momentAgent.js';

// Build a mock `ai` whose generateContent replays a queue of orchestrator
// responses, but answers the nested web_search sub-call separately.
const makeAi = (orchestratorResponses, { webChunks } = {}) => {
  let i = 0;
  const orchestratorConfigs = [];
  const fakeVec = (seed) => {
    const v = new Array(8).fill(0);
    v[seed % 8] = 1;
    return v;
  };
  return {
    orchestratorConfigs,
    models: {
      generateContent: vi.fn(async ({ config }) => {
        const isWebSearch = (config?.tools || []).some((t) => t.googleSearch);
        if (isWebSearch) {
          return {
            text: 'Open 24 hours; rooftop infinity pool.',
            candidates: [
              {
                groundingMetadata: {
                  groundingChunks: webChunks || [
                    { web: { uri: 'https://example.com/mbs', title: 'Marina Bay Sands' } },
                    { web: { uri: 'http://127.0.0.1/internal', title: 'private' } },
                  ],
                },
              },
            ],
          };
        }
        orchestratorConfigs.push(config);
        const resp = orchestratorResponses[i] ?? orchestratorResponses[orchestratorResponses.length - 1];
        i += 1;
        return resp;
      }),
      embedContent: vi.fn(async ({ contents }) => ({
        embeddings: contents.map((_, idx) => ({ values: fakeVec(idx) })),
      })),
    },
  };
};

const fc = (name, args) => ({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });

const NOTES = [
  { id: 'n1', content: 'Marina Bay Sands hotel', tags: ['singapore'], enrichment: { summary: 'Hotel in Singapore', entityContext: { title: 'MBS', type: 'place' } } },
  { id: 'n2', content: 'Hawker chicken rice', tags: ['food'], enrichment: { summary: 'Local dish', entityContext: { title: 'Chicken rice', type: 'food' } } },
];

const finalizeArgs = {
  displayTitle: 'Singapore Trip',
  momentType: 'itinerary',
  emoji: '🇸🇬',
  usedNoteIds: ['n1', 'n2'],
  refinedObjective: 'Plan a Singapore itinerary',
  synthesis: {
    format: 'itinerary',
    title: 'Singapore Trip',
    sections: [
      {
        heading: 'Stay',
        items: [
          { label: 'Marina Bay Sands', sourceType: 'note', sourceNoteId: 'n1' },
          { label: 'Rooftop pool open 24h', sourceType: 'web', sourceUrl: 'https://example.com/mbs' },
        ],
      },
    ],
    generatedFrom: ['n1', 'n2'],
  },
};

describe('runMomentAgent', () => {
  it('runs search → web → embellish → finalize and maps the result', async () => {
    const ai = makeAi([
      fc('search_notes', { query: 'singapore', topK: 5 }),
      fc('web_search', { query: 'Marina Bay Sands hours', purpose: 'embellish' }),
      fc('embellish_note', { noteId: 'n1', addition: 'Rooftop pool open 24h', sourceUrl: 'https://example.com/mbs' }),
      fc('finalize', finalizeArgs),
    ]);

    const result = await runMomentAgent({
      ai, model: 'm', objective: 'Plan Singapore trip', notes: NOTES, requestId: 'r1',
    });

    expect(result.title).toBe('Singapore Trip');
    expect(result.type).toBe('itinerary');
    expect(result.emoji).toBe('🇸🇬');
    expect(result.usedNoteIds).toEqual(['n1', 'n2']);
    expect(result.refinedObjective).toBe('Plan a Singapore itinerary');

    // Web item preserved with sourceType/sourceUrl; note item keeps sourceNoteId.
    const items = result.synthesis.sections[0].items;
    const web = items.find((it) => it.sourceType === 'web');
    expect(web.sourceUrl).toBe('https://example.com/mbs');
    const note = items.find((it) => it.sourceType === 'note');
    expect(note.sourceNoteId).toBe('n1');

    // Embellishment recorded.
    expect(result.noteEmbellishments).toEqual([
      { noteId: 'n1', addition: 'Rooftop pool open 24h', sourceUrl: 'https://example.com/mbs' },
    ]);
  });

  it('drops web items with no usable URL, demoting to note when a noteId exists', async () => {
    const args = {
      ...finalizeArgs,
      synthesis: {
        ...finalizeArgs.synthesis,
        sections: [
          {
            heading: 'Mixed',
            items: [
              { label: 'web no url', sourceType: 'web' }, // dropped (unsourced)
              { label: 'web no url but has note', sourceType: 'web', sourceNoteId: 'n1' }, // demoted
              { label: 'web private url', sourceType: 'web', sourceUrl: 'http://127.0.0.1/x' }, // dropped
              { label: 'good web', sourceType: 'web', sourceUrl: 'https://example.com/ok' }, // kept
            ],
          },
        ],
      },
    };
    const ai = makeAi([fc('finalize', args)]);
    const result = await runMomentAgent({ ai, model: 'm', objective: 'x', notes: NOTES, requestId: 'r7' });
    const items = result.synthesis.sections[0].items;
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('web no url'); // unattributed → dropped
    expect(labels).not.toContain('web private url'); // SSRF-filtered → dropped
    expect(labels).toContain('good web');
    // The web item with a noteId is demoted to a note citation rather than shown unsourced.
    const demoted = items.find((i) => i.label === 'web no url but has note');
    expect(demoted.sourceType).toBe('note');
    expect(demoted.sourceNoteId).toBe('n1');
  });

  it('offers search_notes/read_notes on the inline path', async () => {
    const ai = makeAi([fc('finalize', finalizeArgs)]);
    await runMomentAgent({ ai, model: 'm', objective: 'x', notes: NOTES, requestId: 'r2' });
    const names = ai.orchestratorConfigs[0].tools[0].functionDeclarations.map((d) => d.name);
    expect(names).toContain('search_notes');
    expect(names).toContain('read_notes');
  });

  it('omits search_notes/read_notes on the file-URI path and still finalizes', async () => {
    const ai = makeAi([fc('finalize', finalizeArgs)]);
    const result = await runMomentAgent({
      ai, model: 'm', objective: 'x', notesFileUri: 'files/abc', noteCount: 3, requestId: 'r3',
    });
    const names = ai.orchestratorConfigs[0].tools[0].functionDeclarations.map((d) => d.name);
    expect(names).not.toContain('search_notes');
    expect(names).not.toContain('read_notes');
    expect(names).toContain('web_search');
    expect(result.title).toBe('Singapore Trip');
  });

  it('rejects embellish_note with a private/invalid source URL', async () => {
    const ai = makeAi([
      fc('embellish_note', { noteId: 'n1', addition: 'bad', sourceUrl: 'http://127.0.0.1/x' }),
      fc('finalize', finalizeArgs),
    ]);
    const result = await runMomentAgent({ ai, model: 'm', objective: 'x', notes: NOTES, requestId: 'r4' });
    expect(result.noteEmbellishments).toEqual([]); // private URL filtered out
  });

  it('drops private URLs from web_search citations', async () => {
    // Capture the functionResponse the loop feeds back after web_search by
    // inspecting the contents passed on the turn AFTER the web_search call.
    const ai = makeAi([
      fc('web_search', { query: 'q' }),
      fc('finalize', finalizeArgs),
    ]);
    await runMomentAgent({ ai, model: 'm', objective: 'x', notes: NOTES, requestId: 'r5' });
    // The 2nd orchestrator turn's contents include the web_search functionResponse.
    const secondCall = ai.models.generateContent.mock.calls.find(([arg]) =>
      JSON.stringify(arg.contents).includes('"web_search"') &&
      JSON.stringify(arg.contents).includes('functionResponse')
    );
    const blob = JSON.stringify(secondCall[0].contents);
    expect(blob).toContain('https://example.com/mbs');
    expect(blob).not.toContain('127.0.0.1');
  });

  it('forces a finalize-only turn on the last iteration', async () => {
    // Never emit finalize until forced: every response is a web_search (capped),
    // so the loop must force finalize via toolConfig on the final iteration.
    const ai = makeAi([
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('web_search', { query: 'q' }),
      fc('finalize', finalizeArgs), // returned once finalize is forced
    ]);
    const result = await runMomentAgent({ ai, model: 'm', objective: 'x', notes: NOTES, requestId: 'r6' });
    expect(result.title).toBe('Singapore Trip');
    // At least one orchestrator turn restricted calling to finalize only.
    const forced = ai.orchestratorConfigs.some(
      (c) => c.toolConfig?.functionCallingConfig?.allowedFunctionNames?.includes('finalize')
    );
    expect(forced).toBe(true);
  });
});
