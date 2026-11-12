import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTermEmbeddingText,
  buildFallbackIntentText,
  buildIntentEmbeddingText,
  sanitizeMomentIntent,
  pickEmoji,
  embedMomentTerms,
  resetEmojiVectorCache,
} from './momentEmbedding.js';
import { EMOJI_DICTIONARY, DEFAULT_MOMENT_EMOJI } from './emojiDictionary.js';

const unit = (i, dim = 4) => {
  const v = new Array(dim).fill(0);
  v[i % dim] = 1;
  return v;
};

const INTENT = {
  title: 'Singapore hawker food',
  summary: 'A meal at a Singapore hawker centre.',
  description: 'Chicken rice, laksa and satay stalls at Maxwell or Lau Pa Sat.',
  tags: ['hawker centre', 'laksa', 'chicken rice'],
};

// Fake Gemini client: every content embeds to a one-hot vector chosen by
// `vectorFor`; generateContent returns `intent` as JSON (or throws if it's an Error).
const makeAi = (vectorFor, intent = INTENT) => ({
  models: {
    embedContent: vi.fn(async ({ contents }) => ({
      embeddings: contents.map((c) => ({ values: vectorFor(c.parts[0].text) })),
    })),
    generateContent: vi.fn(async () => {
      if (intent instanceof Error) throw intent;
      return { text: JSON.stringify(intent) };
    }),
  },
});

const MODELS = { model: 'primary', fallbackModel: 'fallback' };

describe('emoji dictionary', () => {
  it('has 200 unique emoji, each with a label', () => {
    expect(EMOJI_DICTIONARY).toHaveLength(200);
    expect(new Set(EMOJI_DICTIONARY.map(([e]) => e)).size).toBe(200);
    for (const [emoji, label] of EMOJI_DICTIONARY) {
      expect(emoji).toBeTruthy();
      expect(label.length).toBeGreaterThan(2);
    }
  });
});

describe('buildTermEmbeddingText', () => {
  it('wraps the term in the note-shaped template', () => {
    expect(buildTermEmbeddingText('  ramen ')).toBe('TITLE: ramen\nTAGS: ramen\nSUMMARY: Notes about ramen.');
  });
});

describe('intent text', () => {
  it('lays the intent out like a note (same labels as buildEmbeddingText)', () => {
    const text = buildIntentEmbeddingText(INTENT);
    expect(text).toContain('TITLE: Singapore hawker food');
    expect(text).toContain('SUMMARY: A meal at a Singapore hawker centre.');
    expect(text).toContain('TAGS: hawker centre, laksa, chicken rice');
    expect(text).toContain('DESCRIPTION: Chicken rice');
    expect(text).not.toContain('CONTENT:');
  });

  it('builds a fallback from all the terms together', () => {
    expect(buildFallbackIntentText(['Singapore', ' hawker food '])).toBe(
      'TITLE: Singapore, hawker food\nSUMMARY: Notes about Singapore and hawker food.\nTAGS: Singapore, hawker food',
    );
  });

  it('sanitizes and caps the model output', () => {
    const out = sanitizeMomentIntent({
      title: '<b>Food</b>', summary: 's', description: 'd',
      tags: ['a', 3, '', ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
    });
    expect(out.title).toBe('Food');
    expect(out.tags[0]).toBe('a');
    expect(out.tags).toHaveLength(12);
    expect(sanitizeMomentIntent({ title: '', summary: '' })).toBeNull();
    expect(sanitizeMomentIntent(null)).toBeNull();
  });
});

describe('pickEmoji', () => {
  it('picks the emoji closest to the mean of the given vectors', () => {
    const emojiVectors = EMOJI_DICTIONARY.map((_, i) => (i === 7 ? unit(1) : unit(0)));
    // Two terms both pointing mostly at dimension 1 → emoji #7.
    expect(pickEmoji([unit(1), [0, 0.9, 0.1, 0]], emojiVectors)).toBe(EMOJI_DICTIONARY[7][0]);
  });

  it('falls back to the default emoji with no vectors', () => {
    expect(pickEmoji([], [])).toBe(DEFAULT_MOMENT_EMOJI);
  });
});

describe('embedMomentTerms', () => {
  beforeEach(() => resetEmojiVectorCache());

  it('returns one vector per term and an emoji matching the intent', async () => {
    const sushiIdx = EMOJI_DICTIONARY.findIndex(([e]) => e === '🍣');
    const sushiLabel = EMOJI_DICTIONARY[sushiIdx][1];
    const ai = makeAi(
      (text) => (text.includes('sushi') || text.includes(sushiLabel) ? unit(2) : unit(0)),
      { title: 'Sushi', summary: 'A sushi dinner.', description: 'Nigiri and maki.', tags: ['sushi'] },
    );

    const { vectors, emoji } = await embedMomentTerms(ai, ['sushi'], MODELS);

    expect(vectors).toEqual([unit(2)]);
    expect(emoji).toBe('🍣');
  });

  it('embeds the LLM-expanded intent alongside the terms in one call', async () => {
    const ai = makeAi((text) => (text.includes('DESCRIPTION: Chicken rice') ? unit(3) : unit(0)));

    const { vectors, intentVector, intentSource } = await embedMomentTerms(ai, ['Singapore', 'hawker food'], MODELS);

    expect(vectors).toEqual([unit(0), unit(0)]);
    expect(intentVector).toEqual(unit(3));
    expect(intentSource).toBe('llm');
    const call = ai.models.generateContent.mock.calls[0][0];
    expect(call.model).toBe('primary');
    expect(call.config.systemInstruction).toMatch(/TOGETHER/);
    expect(call.contents[0].parts[0].text).toContain('- Singapore\n- hawker food');
    const termCall = ai.models.embedContent.mock.calls.find(([a]) => a.contents.length === 3);
    expect(termCall).toBeTruthy();
  });

  it('tries the fallback model, then the plain template, if expansion fails', async () => {
    const ai = makeAi((text) => (text.startsWith('TITLE: Singapore, hawker food\nSUMMARY: Notes about') ? unit(1) : unit(0)), new Error('down'));

    const { intentVector, intentSource } = await embedMomentTerms(ai, ['Singapore', 'hawker food'], MODELS);

    expect(ai.models.generateContent).toHaveBeenCalledTimes(2);
    expect(ai.models.generateContent.mock.calls.map(([a]) => a.model)).toEqual(['primary', 'fallback']);
    expect(intentVector).toEqual(unit(1));
    expect(intentSource).toBe('template');
  });

  it('uses the template without calling a model when none is configured', async () => {
    const ai = makeAi(() => unit(0));
    const { intentSource } = await embedMomentTerms(ai, ['x']);
    expect(ai.models.generateContent).not.toHaveBeenCalled();
    expect(intentSource).toBe('template');
  });

  it('embeds the dictionary only once across requests', async () => {
    const ai = makeAi(() => unit(0));
    await embedMomentTerms(ai, ['a'], MODELS);
    await embedMomentTerms(ai, ['b'], MODELS);
    // 1 dictionary embed (2 batches of 100) + 1 call (terms + intent) per request.
    expect(ai.models.embedContent).toHaveBeenCalledTimes(4);
  });

  it('still returns vectors with the default emoji when the dictionary embed fails', async () => {
    const ai = {
      models: {
        embedContent: vi.fn(async ({ contents }) => {
          if (contents.length > 10) throw new Error('quota');
          return { embeddings: contents.map(() => ({ values: unit(1) })) };
        }),
        generateContent: vi.fn(async () => ({ text: JSON.stringify(INTENT) })),
      },
    };
    const { vectors, intentVector, emoji } = await embedMomentTerms(ai, ['x'], MODELS);
    expect(vectors).toEqual([unit(1)]);
    expect(intentVector).toEqual(unit(1));
    expect(emoji).toBe(DEFAULT_MOMENT_EMOJI);
  });
});
