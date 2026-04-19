import { describe, it, expect } from 'vitest';
import {
  extractHashtags,
  mergeTagsWithHashtags,
  containsUrl,
  linkifyUrls,
  escapeHtml,
  looksLikeMarkdown,
  parseChecklistMarkdown,
  sanitizePastedHtml,
  hasRichFormatting,
  isEditorEmpty,
  formatsEqual,
} from './editorUtils';

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

  it('preserves the order of existing tags before hashtags', () => {
    expect(mergeTagsWithHashtags(['z', 'a'], ['m'])).toEqual(['z', 'a', 'm']);
  });
});

describe('escapeHtml', () => {
  it('escapes the five html-sensitive characters', () => {
    expect(escapeHtml('<a href="&">"bold"</a>')).toBe(
      '&lt;a href=&quot;&amp;&quot;&gt;&quot;bold&quot;&lt;/a&gt;',
    );
  });

  it('handles empty strings', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('escapes & first to avoid double-escaping', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('containsUrl (extended)', () => {
  it('detects URLs in the middle of text', () => {
    expect(containsUrl('before https://x.test/a?b=1 after')).toBe(true);
  });

  it('is case-insensitive for the scheme', () => {
    expect(containsUrl('HTTPS://X.TEST')).toBe(true);
    expect(containsUrl('HTTP://X.TEST')).toBe(true);
  });

  it('rejects ftp and other schemes', () => {
    expect(containsUrl('ftp://x.test/file')).toBe(false);
  });
});

describe('linkifyUrls (extended)', () => {
  it('escapes URLs with angle brackets before linkifying', () => {
    // If " or ' or > sneak into the URL boundary, the regex must not swallow them.
    expect(linkifyUrls('see https://x.test&gt;')).toBe(
      'see <a href="https://x.test" target="_blank" rel="noopener noreferrer">https://x.test</a>&gt;',
    );
  });

  it('does not linkify bare domains or missing schemes', () => {
    expect(linkifyUrls('just google.com')).toBe('just google.com');
  });

  it('linkifies both http and https', () => {
    const result = linkifyUrls('http://a.test and https://b.test');
    expect(result).toContain('href="http://a.test"');
    expect(result).toContain('href="https://b.test"');
  });
});

describe('looksLikeMarkdown', () => {
  it('detects ATX headings', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true);
    expect(looksLikeMarkdown('## H2')).toBe(true);
    expect(looksLikeMarkdown('###### Tiny')).toBe(true);
  });

  it('detects bold (** and __)', () => {
    expect(looksLikeMarkdown('this is **bold**')).toBe(true);
    expect(looksLikeMarkdown('this is __bold__')).toBe(true);
  });

  it('detects italic when surrounded by word characters', () => {
    expect(looksLikeMarkdown('some *italic* text')).toBe(true);
  });

  it('detects unordered list items', () => {
    expect(looksLikeMarkdown('- first\n- second')).toBe(true);
    expect(looksLikeMarkdown('* first')).toBe(true);
    expect(looksLikeMarkdown('+ first')).toBe(true);
  });

  it('detects ordered list items', () => {
    expect(looksLikeMarkdown('1. one\n2. two')).toBe(true);
  });

  it('detects markdown links', () => {
    expect(looksLikeMarkdown('[link](https://x.test)')).toBe(true);
  });

  it('detects blockquotes', () => {
    expect(looksLikeMarkdown('> quoted line')).toBe(true);
  });

  it('detects inline code and fenced code blocks', () => {
    expect(looksLikeMarkdown('run `npm test`')).toBe(true);
    expect(looksLikeMarkdown('```js\ncode\n```')).toBe(true);
  });

  it('detects checklists', () => {
    expect(looksLikeMarkdown('- [ ] task')).toBe(true);
    expect(looksLikeMarkdown('- [x] done')).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(looksLikeMarkdown('just a sentence with nothing special.')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });
});

describe('parseChecklistMarkdown', () => {
  it('returns null when no checklist items are present', () => {
    expect(parseChecklistMarkdown('just text\nnothing to see')).toBeNull();
  });

  it('parses simple unchecked and checked items', () => {
    const result = parseChecklistMarkdown('- [ ] todo\n- [x] done');
    expect(result).toEqual([
      { text: 'todo', checked: false, indent: 0 },
      { text: 'done', checked: true, indent: 0 },
    ]);
  });

  it('treats X (uppercase) as checked', () => {
    expect(parseChecklistMarkdown('- [X] done')).toEqual([
      { text: 'done', checked: true, indent: 0 },
    ]);
  });

  it('detects indented sub-items', () => {
    const result = parseChecklistMarkdown('- [ ] parent\n  - [ ] child');
    expect(result).toEqual([
      { text: 'parent', checked: false, indent: 0 },
      { text: 'child', checked: false, indent: 1 },
    ]);
  });

  it('preserves non-checklist lines between items', () => {
    const result = parseChecklistMarkdown('- [ ] one\nnotes\n- [x] two');
    expect(result).toEqual([
      { text: 'one', checked: false, indent: 0 },
      { text: 'notes', checked: false, indent: 0 },
      { text: 'two', checked: true, indent: 0 },
    ]);
  });

  it('skips entirely blank lines', () => {
    const result = parseChecklistMarkdown('- [ ] one\n\n- [ ] two');
    expect(result).toEqual([
      { text: 'one', checked: false, indent: 0 },
      { text: 'two', checked: false, indent: 0 },
    ]);
  });

  it('supports bare [x]/[ ] without list marker', () => {
    // "[ ] text" and "[x] text" without - should still match.
    expect(parseChecklistMarkdown('[ ] a\n[x] b')).toEqual([
      { text: 'a', checked: false, indent: 0 },
      { text: 'b', checked: true, indent: 0 },
    ]);
  });
});

describe('sanitizePastedHtml', () => {
  it('strips <script> and <style> tags entirely', () => {
    const out = sanitizePastedHtml('<p>ok</p><script>alert(1)</script><style>body{}</style>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('body{');
    expect(out).toContain('ok');
  });

  it('keeps allowed structural tags', () => {
    const out = sanitizePastedHtml('<h2>Title</h2><ul><li>one</li></ul>');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<ul><li>one</li></ul>');
  });

  it('replaces disallowed tags with <span>', () => {
    const out = sanitizePastedHtml('<iframe src="javascript:alert(1)"></iframe>');
    // iframe is not in the allow-list so it becomes <span>…</span>.
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('javascript:');
  });

  it('strips unsafe URL protocols from <a href>', () => {
    const out = sanitizePastedHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('>x</a>');
  });

  it('keeps safe protocols on <a> and adds rel/target', () => {
    const out = sanitizePastedHtml('<a href="https://x.test">link</a>');
    expect(out).toContain('href="https://x.test"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('preserves text nodes between tags', () => {
    const out = sanitizePastedHtml('hello <b>world</b>!');
    expect(out).toContain('hello ');
    expect(out).toContain('<b>world</b>');
    expect(out).toContain('!');
  });

  it('drops style attributes from allowed tags', () => {
    const out = sanitizePastedHtml('<p style="color:red">x</p>');
    expect(out).not.toContain('style=');
    expect(out).toContain('<p>x</p>');
  });
});

describe('hasRichFormatting', () => {
  it('returns true when any rich tag is present', () => {
    expect(hasRichFormatting('<b>bold</b>')).toBe(true);
    expect(hasRichFormatting('<h2>heading</h2>')).toBe(true);
    expect(hasRichFormatting('<ul><li>one</li></ul>')).toBe(true);
    expect(hasRichFormatting('<a href="#">link</a>')).toBe(true);
    expect(hasRichFormatting('<blockquote>q</blockquote>')).toBe(true);
    expect(hasRichFormatting('<code>c</code>')).toBe(true);
    expect(hasRichFormatting('<s>strike</s>')).toBe(true);
  });

  it('returns false for plain text or only-paragraph html', () => {
    expect(hasRichFormatting('just text')).toBe(false);
    expect(hasRichFormatting('<p>plain paragraph</p>')).toBe(false);
  });
});

describe('isEditorEmpty', () => {
  it('returns true for null', () => {
    expect(isEditorEmpty(null)).toBe(true);
  });

  // jsdom does not implement HTMLElement.innerText, so we stub it to the
  // textContent fallback (matching real-browser behaviour closely enough
  // for this helper's purposes).
  const withInnerText = (text: string, innerHtml?: string): HTMLDivElement => {
    const div = document.createElement('div') as HTMLDivElement;
    if (innerHtml) div.innerHTML = innerHtml;
    Object.defineProperty(div, 'innerText', { value: text, configurable: true });
    return div;
  };

  it('returns true when text is empty and no list exists', () => {
    expect(isEditorEmpty(withInnerText(''))).toBe(true);
  });

  it('returns true for whitespace-only text', () => {
    expect(isEditorEmpty(withInnerText('   \n\t '))).toBe(true);
  });

  it('returns false when a list element is present even with empty text', () => {
    expect(isEditorEmpty(withInnerText('', '<ul><li></li></ul>'))).toBe(false);
  });

  it('returns false when there is visible text', () => {
    expect(isEditorEmpty(withInnerText('hello'))).toBe(false);
  });
});

describe('formatsEqual', () => {
  it('returns true for identical arrays', () => {
    expect(formatsEqual(['bold', 'italic'], ['bold', 'italic'])).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(formatsEqual(['bold'], ['bold', 'italic'])).toBe(false);
  });

  it('returns false when any element differs', () => {
    expect(formatsEqual(['bold', 'italic'], ['bold', 'underline'])).toBe(false);
  });

  it('is order-sensitive (arrays are constructed in a known order)', () => {
    // formatsEqual does a positional comparison — this pins that contract
    // so callers know not to rely on it for set-equality.
    expect(formatsEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('handles empty arrays', () => {
    expect(formatsEqual([], [])).toBe(true);
  });
});
