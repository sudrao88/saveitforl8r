import { describe, it, expect } from 'vitest';
import { extractHashtags, mergeTagsWithHashtags, containsUrl, linkifyUrls } from './editorUtils';

describe('extractHashtags', () => {
  it('extracts a single hashtag', () => {
    expect(extractHashtags('Check out #recipe')).toEqual(['recipe']);
  });

  it('extracts multiple hashtags', () => {
    expect(extractHashtags('#work #meeting notes')).toEqual(['work', 'meeting']);
  });

  it('deduplicates case-insensitively, keeping first occurrence', () => {
    expect(extractHashtags('#Recipe #recipe #RECIPE')).toEqual(['Recipe']);
  });

  it('ignores standalone # without letters', () => {
    expect(extractHashtags('# heading')).toEqual([]);
    expect(extractHashtags('just a #')).toEqual([]);
  });

  it('ignores hashtags starting with a digit', () => {
    expect(extractHashtags('color #123abc and #456')).toEqual([]);
  });

  it('treats letter-starting tokens as hashtags even if hex-like', () => {
    // #fff starts with a letter so it's treated as a valid hashtag
    expect(extractHashtags('color #fff')).toEqual(['fff']);
  });

  it('extracts hashtags from HTML content', () => {
    expect(extractHashtags('<b>#important</b> note with #tag')).toEqual(['important', 'tag']);
  });

  it('handles hashtags with hyphens and underscores', () => {
    expect(extractHashtags('#to-read #my_list')).toEqual(['to-read', 'my_list']);
  });

  it('returns empty array for text without hashtags', () => {
    expect(extractHashtags('just some plain text')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractHashtags('')).toEqual([]);
  });

  it('extracts hashtags after commas and semicolons', () => {
    expect(extractHashtags('ideas,#brainstorm;#creative')).toEqual(['brainstorm', 'creative']);
  });

  it('handles HTML entities in content', () => {
    expect(extractHashtags('&amp; #notes &lt;tag&gt;')).toEqual(['notes']);
  });
});

describe('containsUrl', () => {
  it('detects http URLs', () => {
    expect(containsUrl('Visit http://example.com')).toBe(true);
  });

  it('detects https URLs', () => {
    expect(containsUrl('Check out https://puttingscene.com/events/3349')).toBe(true);
  });

  it('returns false for text without URLs', () => {
    expect(containsUrl('Just some plain text')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsUrl('')).toBe(false);
  });
});

describe('linkifyUrls', () => {
  it('converts a URL to a clickable link', () => {
    const input = 'Check out https://puttingscene.com/events/3349';
    const result = linkifyUrls(input);
    expect(result).toBe(
      'Check out <a href="https://puttingscene.com/events/3349" target="_blank" rel="noopener noreferrer">https://puttingscene.com/events/3349</a>'
    );
  });

  it('handles text with URL and surrounding content', () => {
    const input = 'Hello https://example.com world';
    const result = linkifyUrls(input);
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('>https://example.com</a>');
    expect(result).toContain('Hello ');
    expect(result).toContain(' world');
  });

  it('handles escaped ampersands in URLs', () => {
    const input = 'https://example.com?a=1&amp;b=2';
    const result = linkifyUrls(input);
    expect(result).toBe(
      '<a href="https://example.com?a=1&b=2" target="_blank" rel="noopener noreferrer">https://example.com?a=1&amp;b=2</a>'
    );
  });

  it('leaves text without URLs unchanged', () => {
    expect(linkifyUrls('Just plain text')).toBe('Just plain text');
  });
});

describe('mergeTagsWithHashtags', () => {
  it('merges without duplicates', () => {
    expect(mergeTagsWithHashtags(['work'], ['meeting', 'work'])).toEqual(['work', 'meeting']);
  });

  it('deduplicates case-insensitively', () => {
    expect(mergeTagsWithHashtags(['Work'], ['work', 'play'])).toEqual(['Work', 'play']);
  });

  it('returns existing tags when no hashtags', () => {
    expect(mergeTagsWithHashtags(['existing'], [])).toEqual(['existing']);
  });

  it('returns hashtags when no existing tags', () => {
    expect(mergeTagsWithHashtags([], ['new', 'tags'])).toEqual(['new', 'tags']);
  });
});
