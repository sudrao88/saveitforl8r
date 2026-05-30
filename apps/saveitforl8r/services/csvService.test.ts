import { describe, it, expect, vi } from 'vitest';
import { memoriesToCSV, parseCSV, csvToMemories } from './csvService';
import { Memory } from '../types';

const baseMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'mem-1',
  timestamp: 1700000000000,
  content: 'Hello world',
  tags: [],
  ...overrides,
});

describe('memoriesToCSV', () => {
  it('emits a header row with the expected columns', () => {
    const csv = memoriesToCSV([]);
    expect(csv).toBe(
      'id,timestamp,date_iso,content,type,tags,summary,location_json,attachments_json,enrichment_json',
    );
  });

  it('serializes a simple memory without quoting when no special chars', () => {
    const csv = memoriesToCSV([baseMemory({ content: 'plain', tags: ['a', 'b'] })]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('mem-1');
    expect(lines[1]).toContain(',plain,');
    expect(lines[1]).toContain(',a|b,'); // tags joined with pipe
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const csv = memoriesToCSV([
      baseMemory({ content: 'has, comma' }),
      baseMemory({ id: 'mem-2', content: 'has "quote"' }),
      baseMemory({ id: 'mem-3', content: 'has\nnewline' }),
    ]);
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"has\nnewline"');
  });

  it('emits empty strings for missing optional fields', () => {
    const csv = memoriesToCSV([baseMemory()]);
    const rows = parseCSV(csv);
    const data = rows[1];
    // type (index 4) and summary (index 6) are empty
    expect(data[4]).toBe('');
    expect(data[6]).toBe('');
    // location_json (index 7) is "null"
    expect(data[7]).toBe('null');
    // attachments_json (index 8) is "[]"
    expect(data[8]).toBe('[]');
  });

  it('drops legacy enrichment.audit field from exports', () => {
    const csv = memoriesToCSV([
      baseMemory({
        enrichment: {
          summary: 'x',
          suggestedTags: [],
          audit: { prompt: 'secret' },
        },
      }),
    ]);
    expect(csv).not.toContain('audit');
    expect(csv).not.toContain('secret');
  });
});

describe('parseCSV', () => {
  it('splits a simple row on commas', () => {
    expect(parseCSV('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('respects quoted fields containing commas', () => {
    expect(parseCSV('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles escaped quotes within quoted fields', () => {
    expect(parseCSV('"he said ""hi""",next')).toEqual([
      ['he said "hi"', 'next'],
    ]);
  });

  it('preserves newlines inside quoted fields', () => {
    expect(parseCSV('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCSV('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('skips blank rows between records', () => {
    expect(parseCSV('a,b\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('captures the final row when the file has no trailing newline', () => {
    expect(parseCSV('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('csvToMemories', () => {
  it('returns an empty array when only a header is present', () => {
    const csv = memoriesToCSV([]);
    expect(csvToMemories(csv)).toEqual([]);
  });

  it('returns an empty array when input is blank', () => {
    expect(csvToMemories('')).toEqual([]);
  });

  it('round-trips a simple memory', () => {
    const original = baseMemory({
      content: 'lorem ipsum',
      tags: ['alpha', 'beta'],
    });
    const parsed = csvToMemories(memoriesToCSV([original]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(original.id);
    expect(parsed[0].timestamp).toBe(original.timestamp);
    expect(parsed[0].content).toBe(original.content);
    expect(parsed[0].tags).toEqual(original.tags);
  });

  it('round-trips content containing commas, quotes, and newlines', () => {
    const original = baseMemory({
      content: 'has, "embedded"\nfields',
    });
    const parsed = csvToMemories(memoriesToCSV([original]));
    expect(parsed[0].content).toBe(original.content);
  });

  it('round-trips location, attachments, and enrichment JSON', () => {
    const original: Memory = baseMemory({
      location: { latitude: 37.7, longitude: -122.4 },
      attachments: [
        { id: 'a1', type: 'image', mimeType: 'image/jpeg', name: 'photo.jpg' },
      ],
      enrichment: {
        summary: 'a summary',
        suggestedTags: ['tagA'],
        entityContext: { type: 'Book', title: 'Dune' },
      },
    });
    const parsed = csvToMemories(memoriesToCSV([original]));
    expect(parsed[0].location).toEqual(original.location);
    expect(parsed[0].attachments).toEqual(original.attachments);
    expect(parsed[0].enrichment).toEqual(original.enrichment);
  });

  it('drops rows with invalid timestamps', () => {
    const header =
      'id,timestamp,date_iso,content,type,tags,summary,location_json,attachments_json,enrichment_json';
    const bad = `${header}\nno-ts,abc,,hello,,,,null,null,null`;
    expect(csvToMemories(bad)).toEqual([]);
  });

  it('drops rows missing an id', () => {
    const header =
      'id,timestamp,date_iso,content,type,tags,summary,location_json,attachments_json,enrichment_json';
    const bad = `${header}\n,1700000000000,,hello,,,,null,null,null`;
    expect(csvToMemories(bad)).toEqual([]);
  });

  it('tolerates malformed JSON in one row without dropping the rest', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const header =
      'id,timestamp,date_iso,content,type,tags,summary,location_json,attachments_json,enrichment_json';
    // Row with broken JSON in location_json triggers catch; next row is fine
    const csv = [
      header,
      'm-bad,1700000000000,,hello,,,,{broken,null,null',
      'm-good,1700000000001,,ok,,,,null,null,null',
    ].join('\n');
    const parsed = csvToMemories(csv);
    expect(parsed.map(m => m.id)).toEqual(['m-good']);
    warnSpy.mockRestore();
  });

  it('strips the legacy audit field from imported enrichment', () => {
    const header =
      'id,timestamp,date_iso,content,type,tags,summary,location_json,attachments_json,enrichment_json';
    const enrichment = JSON.stringify({
      summary: 's',
      suggestedTags: [],
      audit: { secret: true },
    });
    const csv = `${header}\nm-1,1700000000000,,content,,,,null,null,"${enrichment.replace(/"/g, '""')}"`;
    const parsed = csvToMemories(csv);
    expect(parsed).toHaveLength(1);
    expect((parsed[0].enrichment as Record<string, unknown>).audit).toBeUndefined();
    expect(parsed[0].enrichment!.summary).toBe('s');
  });
});
