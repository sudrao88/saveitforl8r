export const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Heuristically detect whether plain text contains markdown formatting. */
export const looksLikeMarkdown = (text: string): boolean => {
    return [
        /^#{1,6}\s/m,            // Headings: # text
        /\*\*[^*]+\*\*/,         // Bold: **text**
        /__[^_]+__/,             // Bold: __text__
        /(?<!\*)\*(?!\s)[^*]+(?<!\s)\*(?!\*)/,  // Italic: *text*
        /^[-*+]\s/m,             // Unordered lists: - item
        /^\d+\.\s/m,             // Ordered lists: 1. item
        /\[[^\]]+\]\([^)]+\)/,   // Links: [text](url)
        /^>/m,                   // Blockquotes: > text
        /`[^`]+`/,               // Inline code: `code`
        /^```/m,                 // Code blocks: ```
        /^[-*+]?\s*\[[ xX]\]\s/m,  // Checklists: [ ] item, - [x] item
    ].some(pattern => pattern.test(text));
};

/** Detect whether text contains checklist markdown and parse items from it. */
export const parseChecklistMarkdown = (text: string): { text: string; checked: boolean }[] | null => {
    const lines = text.split('\n').filter(l => l.trim());
    // At least one line must be a checklist item
    const checklistPattern = /^[-*+]?\s*\[([ xX])\]\s+(.*)/;
    const items: { text: string; checked: boolean }[] = [];
    let hasChecklistItem = false;

    for (const line of lines) {
        const match = line.match(checklistPattern);
        if (match) {
            hasChecklistItem = true;
            items.push({ text: match[2], checked: match[1].toLowerCase() === 'x' });
        } else {
            // Non-checklist line — treat as unchecked item to preserve content
            items.push({ text: line.trim(), checked: false });
        }
    }

    return hasChecklistItem ? items : null;
};

const ALLOWED_TAGS = new Set([
    'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'PRE', 'CODE', 'DIV', 'SPAN',
    'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
]);

const SAFE_URL_PROTOCOLS = /^(https?:|mailto:|tel:)/i;

/** Sanitize pasted HTML: keep structural formatting, strip styles & unwanted elements. */
export const sanitizePastedHtml = (html: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const cleanNode = (node: Node): Node | null => {
        if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
        if (node.nodeType !== Node.ELEMENT_NODE) return null;

        const el = node as Element;
        if (['SCRIPT', 'STYLE', 'META', 'LINK'].includes(el.tagName)) return null;

        let newEl: Element;
        if (ALLOWED_TAGS.has(el.tagName)) {
            newEl = document.createElement(el.tagName);
            if (el.tagName === 'A') {
                const href = el.getAttribute('href') || '';
                if (SAFE_URL_PROTOCOLS.test(href)) {
                    newEl.setAttribute('href', href);
                    newEl.setAttribute('target', '_blank');
                    newEl.setAttribute('rel', 'noopener noreferrer');
                }
            }
        } else {
            newEl = document.createElement('span');
        }

        for (const child of el.childNodes) {
            const cleaned = cleanNode(child);
            if (cleaned) newEl.appendChild(cleaned);
        }
        return newEl;
    };

    const fragment = document.createDocumentFragment();
    for (const child of doc.body.childNodes) {
        const cleaned = cleanNode(child);
        if (cleaned) fragment.appendChild(cleaned);
    }

    const container = document.createElement('div');
    container.appendChild(fragment);
    return container.innerHTML;
};

/** Extract hashtags from text/HTML content and return as deduplicated tag strings (without #). */
export const extractHashtags = (content: string): string[] => {
    // Use DOMParser to strip HTML tags and decode all entities in one step
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const plainText = doc.body.textContent || '';

    // Match hashtags: # followed by a letter, then alphanumeric/underscore/hyphen
    const matches = plainText.match(/(?:^|[\s,;(])#([a-zA-Z][a-zA-Z0-9_-]*)/g);
    if (!matches) return [];

    const seen = new Set<string>();
    const tags: string[] = [];
    for (const match of matches) {
        // Extract the tag part (after #)
        const hashIndex = match.indexOf('#');
        const tag = match.slice(hashIndex + 1);
        const lower = tag.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            tags.push(tag);
        }
    }
    return tags;
};

/** Merge extracted hashtags with existing tags, deduplicating case-insensitively. */
export const mergeTagsWithHashtags = (existingTags: string[], hashtags: string[]): string[] => {
    const seen = new Set(existingTags.map(t => t.toLowerCase()));
    const merged = [...existingTags];
    for (const tag of hashtags) {
        if (!seen.has(tag.toLowerCase())) {
            seen.add(tag.toLowerCase());
            merged.push(tag);
        }
    }
    return merged;
};

/** Check whether HTML contains meaningful structural formatting beyond plain text. */
export const hasRichFormatting = (html: string): boolean => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.querySelectorAll(
        'b, strong, i, em, u, h1, h2, h3, h4, h5, h6, ul, ol, li, a, blockquote, pre, code, table, s, strike, del'
    ).length > 0;
};
