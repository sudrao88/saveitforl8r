import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTermEmbeddingText,
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

// Fake Gemini client: every content embeds to a one-hot vector chosen by `vectorFor`.
const makeAi = (vectorFor) => ({
  models: {
    embedContent: vi.fn(async ({ contents }) => ({
      embeddings: contents.map((c) => ({ values: vectorFor(c.parts[0].text) })),
    })),
  },
});

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

describe('pickEmoji', () => {
  it('picks the emoji closest to the mean of the term vectors', () => {
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

  it('returns one vector per term and an emoji from the dictionary', async () => {
    const sushiIdx = EMOJI_DICTIONARY.findIndex(([e]) => e === '🍣');
    const sushiLabel = EMOJI_DICTIONARY[sushiIdx][1];
    const ai = makeAi((text) => (text.includes('sushi') || text.includes(sushiLabel) ? unit(2) : unit(0)));

    const { vectors, emoji } = await embedMomentTerms(ai, ['sushi']);

    expect(vectors).toEqual([unit(2)]);
    expect(emoji).toBe('🍣');
  });

  it('embeds the dictionary only once across requests', async () => {
    const ai = makeAi(() => unit(0));
    await embedMomentTerms(ai, ['a']);
    await embedMomentTerms(ai, ['b']);
    // 1 dictionary embed (2 batches of 100) + 1 call per request.
    expect(ai.models.embedContent).toHaveBeenCalledTimes(4);
  });

  it('still returns vectors with the default emoji when the dictionary embed fails', async () => {
    const ai = {
      models: {
        embedContent: vi.fn(async ({ contents }) => {
          if (contents.length > 1) throw new Error('quota');
          return { embeddings: [{ values: unit(1) }] };
        }),
      },
    };
    const { vectors, emoji } = await embedMomentTerms(ai, ['x']);
    expect(vectors).toEqual([unit(1)]);
    expect(emoji).toBe(DEFAULT_MOMENT_EMOJI);
  });
});
