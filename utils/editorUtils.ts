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
    ].some(pattern => pattern.test(text));
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

/** Check whether HTML contains meaningful structural formatting beyond plain text. */
export const hasRichFormatting = (html: string): boolean => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.querySelectorAll(
        'b, strong, i, em, u, h1, h2, h3, h4, h5, h6, ul, ol, li, a, blockquote, pre, code, table, s, strike, del'
    ).length > 0;
};
