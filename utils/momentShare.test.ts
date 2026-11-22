import { describe, it, expect } from 'vitest';
import { formatMomentForShare, htmlToShareLines, momentShareTitle } from './momentShare';
import { Memory, Moment } from '../types';

const moment: Moment = {
  id: 'm1', title: 'Singapore · hawker food', terms: ['Singapore', 'hawker food'],
  emoji: '🍜', createdAt: 0, updatedAt: 0,
};

const note = (id: string, overrides: Partial<Memory> = {}): Memory => ({
  id, content: '', timestamp: Date.UTC(2026, 2, 12, 12), tags: [], ...overrides,
});

describe('htmlToShareLines', () => {
  it('keeps list and checklist structure and decodes entities', () => {
    const html = '<p>Try &amp; eat</p><ul><li>Laksa</li><li>Satay</li></ul>'
      + '<ul class="checklist"><li data-checked="true">Book</li><li data-checked="false">Pack</li></ul>';
    expect(htmlToShareLines(html)).toEqual(['Try & eat', '• Laksa', '• Satay', '☑ Book', '☐ Pack']);
  });
});

describe('formatMomentForShare', () => {
  it('formats a header, numbered notes with details, and a footer', () => {
    const notes = [
      note('n1', {
        content: '<p>Best chicken rice</p>',
        enrichment: {
          summary: 'Hawker stall', suggestedTags: [],
          entityContext: { type: 'Place', title: 'Tian Tian' },
          locationContext: { name: 'Maxwell Food Centre', mapsUri: 'https://maps.example/tt' },
        },
      }),
      note('n2', { content: 'Laksa at Katong https://example.com/laksa' }),
    ];
    const text = formatMomentForShare(moment, notes);

    expect(text.startsWith('🍜 Singapore · hawker food\nSingapore · hawker food\n2 notes\n')).toBe(true);
    expect(text).toContain('1. Tian Tian\n   Best chicken rice\n   📍 Maxwell Food Centre · 🗓 ');
    expect(text).toContain('   🔗 https://maps.example/tt');
    expect(text).toContain('2. Laksa at Katong https://example.com/laksa\n   🗓 ');
    expect(text).toContain('   🔗 https://example.com/laksa');
    expect(text.endsWith('— Shared from SaveItForL8R')).toBe(true);
  });

  it('skips terms that repeat the title and handles no notes', () => {
    const single: Moment = { ...moment, title: 'Cafes', terms: ['Cafes'], emoji: undefined };
    expect(momentShareTitle(single)).toBe('✨ Cafes');
    expect(formatMomentForShare(single, [])).toBe('✨ Cafes\n0 notes\n────────────────\n\nNo notes yet.\n\n— Shared from SaveItForL8R');
  });
});
