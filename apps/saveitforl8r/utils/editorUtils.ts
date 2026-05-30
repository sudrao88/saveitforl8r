/** Check whether the editor is effectively empty (no text and no list elements). */
export const isEditorEmpty = (editor: HTMLDivElement | null): boolean => {
    if (!editor) return true;
    return !editor.innerText.trim() && !editor.querySelector('ul, ol');
};

export const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Detect whether text contains URLs. */
export const containsUrl = (text: string): boolean =>
    /https?:\/\/[^\s<>"'\]]+/i.test(text);

/** Convert URLs in already-escaped HTML text to clickable <a> tags. */
export const linkifyUrls = (escapedHtml: string): string =>
    escapedHtml.replace(
        /https?:\/\/[^\s&<>"'\]]+(?:&amp;[^\s&<>"'\]]+)*/gi,
        (url) => {
            // Unescape &amp; back to & for the href attribute
            const href = url.replace(/&amp;/g, '&');
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        }
    );

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
        /^\s*[-*+]?\s*\[[ xX]\]\s/m,  // Checklists: [ ] item, - [x] item
    ].some(pattern => pattern.test(text));
};

/** Detect whether text contains checklist markdown and parse items from it.
 *  Supports indented sub-items (2+ leading spaces before the marker). */
export const parseChecklistMarkdown = (text: string): { text: string; checked: boolean; indent?: number }[] | null => {
    const lines = text.split('\n');
    const checklistPattern = /^(\s*)[-*+]?\s*\[([ xX])\]\s+(.*)/;
    const items: { text: string; checked: boolean; indent?: number }[] = [];
    let hasChecklistItem = false;

    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }

        const match = line.match(checklistPattern);
        if (match) {
            hasChecklistItem = true;
            const leadingSpaces = match[1].length;
            const indent = leadingSpaces >= 2 ? 1 : 0;
            items.push({ text: match[3], checked: match[2].toLowerCase() === 'x', indent });
        } else {
            items.push({ text: line.trim(), checked: false, indent: 0 });
        }
    }

    return hasChecklistItem ? items : null;
};

const ALLOWED_TAGS = new Set([
    'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'PRE', 'CODE', 'DIV', 'SPAN',
    'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'HR',
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

// ─── Rich Text Editor Utilities ───────────────────────────────────────────────

/** Find the closest ancestor matching a tag name, stopping at the editor root. */
const closestBlock = (node: Node | null, editorEl: HTMLElement): HTMLElement | null => {
    let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
    while (el && el !== editorEl) {
        if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV'].includes(el.tagName)) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
};

/** Check if the cursor is inside a specific ancestor tag. */
const isInsideTag = (node: Node | null, tagName: string, editorEl: HTMLElement): boolean => {
    let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
    while (el && el !== editorEl) {
        if (el.tagName === tagName) return true;
        el = el.parentElement;
    }
    return false;
};

/** Get the text content before the cursor in the current text node. */
const getTextBeforeCursor = (selection: Selection): string => {
    const node = selection.anchorNode;
    if (node?.nodeType !== Node.TEXT_NODE) return '';
    return node.textContent?.slice(0, selection.anchorOffset) || '';
};

/** Check if the cursor is at the start of a block element (only whitespace/markers before cursor). */
const isAtBlockStart = (selection: Selection, editorEl: HTMLElement): boolean => {
    const node = selection.anchorNode;
    if (!node) return false;

    const block = closestBlock(node, editorEl);
    if (!block) return true; // Direct child of editor = start of block

    // Check if there's only the current text node before cursor in this block
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode && textNode !== node) {
        if (textNode.textContent?.trim()) return false;
        textNode = walker.nextNode();
    }
    return true;
};

/**
 * Execute a formatting command first (while DOM has valid content), then
 * remove the markdown trigger characters from the resulting block.
 *
 * Older approach emptied the text node before calling execCommand, which
 * caused browsers to silently fail when the selection sat inside an empty
 * text node with no surrounding block element.
 */
const formatThenCleanup = (
    command: string,
    charsToRemove: number,
    value?: string
) => {
    // Execute the command while the trigger text is still in the DOM,
    // giving the browser a valid block to convert.
    document.execCommand(command, false, value);

    // Now remove the trigger characters (e.g. "- ", "1. ", "# ", "> ")
    // from the start of the newly formatted block.
    const sel = window.getSelection();
    if (!sel?.anchorNode) return;

    // After execCommand the cursor is inside the new structure.
    // Walk to the first text node in the current block and strip the prefix.
    const anchor = sel.anchorNode;
    const container = anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : anchor as HTMLElement;
    if (!container) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode() as Text | null;
    if (firstText && firstText.textContent) {
        firstText.textContent = firstText.textContent.slice(charsToRemove);
        // Place cursor at the start of the cleaned text
        const range = document.createRange();
        range.setStart(firstText, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }
};

/** Try to apply inline markdown formatting (e.g. **bold**, *italic*, `code`, ~~strike~~).
 *  Called on Space — converts closing delimiters into formatted elements.
 *  Returns true if a pattern matched and formatting was applied. */
const tryInlineMarkdown = (): boolean => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return false;

    const text = sel.anchorNode.textContent || '';
    const offset = sel.anchorOffset;
    const before = text.slice(0, offset);

    // Patterns: **text**, *text*, ~~text~~, `text`
    // Italic uses word-boundary-aware regex to avoid false positives like "5*5"
    const patterns: { regex: RegExp; wrapTag: string }[] = [
        { regex: /\*\*(.+?)\*\*$/, wrapTag: 'strong' },
        { regex: /(?<![\\w*])\*([^*]+)\*$/, wrapTag: 'em' },
        { regex: /~~(.+?)~~$/, wrapTag: 's' },
        { regex: /`(.+?)`$/, wrapTag: 'code' },
    ];

    for (const { regex, wrapTag } of patterns) {
        const match = before.match(regex);
        if (match) {
            const fullMatch = match[0];
            const innerText = match[1];
            const textNode = sel.anchorNode as Text;

            // Remove the markdown syntax and wrap content in the appropriate tag
            const startIdx = offset - fullMatch.length;
            const beforeText = text.slice(0, startIdx);
            const afterText = text.slice(offset);

            // Build replacement
            const parent = textNode.parentNode!;
            const frag = document.createDocumentFragment();

            if (beforeText) frag.appendChild(document.createTextNode(beforeText));

            const wrapper = document.createElement(wrapTag);
            wrapper.textContent = innerText;
            frag.appendChild(wrapper);

            // Add a non-breaking space after (since user pressed space) and position cursor there
            const spaceNode = document.createTextNode('\u00A0' + afterText);
            frag.appendChild(spaceNode);

            parent.replaceChild(frag, textNode);

            // Place cursor after the space
            const range = document.createRange();
            range.setStart(spaceNode, 1);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);

            return true;
        }
    }
    return false;
};

/**
 * Core logic for space-triggered markdown shortcuts (block-level and inline).
 * Shared by the keydown handler (desktop) and beforeinput handler (Android).
 * Returns true if a shortcut was applied.
 */
const handleSpaceMarkdown = (editorEl: HTMLElement): boolean => {
    const sel = window.getSelection();
    if (!sel?.anchorNode) return false;

    const textBefore = getTextBeforeCursor(sel);

    // Block-level shortcuts — only at the start of a block
    if (isAtBlockStart(sel, editorEl)) {
        if (textBefore === '-' || textBefore === '*' || textBefore === '+') {
            formatThenCleanup('insertUnorderedList', textBefore.length);
            return true;
        } else if (/^\d+\.$/.test(textBefore)) {
            formatThenCleanup('insertOrderedList', textBefore.length);
            return true;
        } else if (textBefore === '#') {
            formatThenCleanup('formatBlock', 1, 'H1');
            return true;
        } else if (textBefore === '##') {
            formatThenCleanup('formatBlock', 2, 'H2');
            return true;
        } else if (textBefore === '>') {
            formatThenCleanup('formatBlock', 1, 'BLOCKQUOTE');
            return true;
        }
    }

    // Inline markdown (works anywhere)
    if (tryInlineMarkdown()) return true;

    return false;
};

/**
 * Handle keydown events in the rich text editor for markdown auto-formatting,
 * list behavior, and keyboard shortcuts.
 *
 * Returns true if the event was handled (and preventDefault was called).
 */
export const handleEditorKeyDown = (
    e: KeyboardEvent | React.KeyboardEvent,
    editorEl: HTMLElement,
    checkFormats: () => void
): boolean => {
    const sel = window.getSelection();
    const mod = e.metaKey || e.ctrlKey;

    // ── Keyboard shortcuts ──────────────────────────────────────────────────
    if (mod && e.shiftKey) {
        let handled = true;
        switch (e.key.toLowerCase()) {
            case 's':
                document.execCommand('strikeThrough');
                break;
            case '7':
                document.execCommand('insertOrderedList');
                break;
            case '8':
                document.execCommand('insertUnorderedList');
                break;
            case '9':
                document.execCommand('formatBlock', false, 'BLOCKQUOTE');
                break;
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
            checkFormats();
            return true;
        }
    }

    if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleCodeFormat();
        checkFormats();
        return true;
    }

    // ── Clear inline formatting (Cmd/Ctrl+\) ────────────────────────────────
    if (mod && e.key === '\\') {
        e.preventDefault();
        document.execCommand('removeFormat');
        checkFormats();
        return true;
    }

    // ── Tab for list indentation ────────────────────────────────────────────
    if (e.key === 'Tab' && sel?.anchorNode) {
        if (isInsideTag(sel.anchorNode, 'LI', editorEl)) {
            e.preventDefault();
            if (e.shiftKey) {
                document.execCommand('outdent');
            } else {
                document.execCommand('indent');
            }
            checkFormats();
            return true;
        }
    }

    // ── Enter key handling ──────────────────────────────────────────────────
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
        if (!sel?.anchorNode) return false;

        // --- Horizontal rule: typing "---" then Enter ---
        const textBefore = getTextBeforeCursor(sel);
        if (textBefore === '---' && isAtBlockStart(sel, editorEl)) {
            e.preventDefault();
            const textNode = sel.anchorNode as Text;
            const after = textNode.textContent?.slice(sel.anchorOffset) || '';
            textNode.textContent = after || '';

            // Insert HR
            document.execCommand('insertHorizontalRule');
            checkFormats();
            return true;
        }

        // --- Empty list item: exit list ---
        const li = (sel.anchorNode.nodeType === Node.TEXT_NODE
            ? sel.anchorNode.parentElement
            : sel.anchorNode as HTMLElement)?.closest?.('li');

        if (li && !li.textContent?.trim()) {
            e.preventDefault();
            const list = li.parentElement;
            if (list && (list.tagName === 'UL' || list.tagName === 'OL')) {
                // If this is the only item, remove the whole list
                if (list.children.length <= 1) {
                    const p = document.createElement('p');
                    p.appendChild(document.createElement('br'));
                    list.parentNode?.replaceChild(p, list);

                    const range = document.createRange();
                    range.setStart(p, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    // Remove the empty li and insert a paragraph after the list
                    list.removeChild(li);
                    const p = document.createElement('p');
                    p.appendChild(document.createElement('br'));
                    list.parentNode?.insertBefore(p, list.nextSibling);

                    const range = document.createRange();
                    range.setStart(p, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
            checkFormats();
            return true;
        }

        // --- Exit blockquote on double Enter (empty line in blockquote) ---
        const bq = (sel.anchorNode.nodeType === Node.TEXT_NODE
            ? sel.anchorNode.parentElement
            : sel.anchorNode as HTMLElement)?.closest?.('blockquote');

        if (bq) {
            const block = closestBlock(sel.anchorNode, editorEl);
            if (block && !block.textContent?.trim() && block.parentElement === bq) {
                e.preventDefault();
                bq.removeChild(block);
                const p = document.createElement('p');
                p.appendChild(document.createElement('br'));
                bq.parentNode?.insertBefore(p, bq.nextSibling);
                if (!bq.children.length) bq.remove();

                const range = document.createRange();
                range.setStart(p, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                checkFormats();
                return true;
            }
        }
    }

    // ── Space key: block-level & inline markdown shortcuts ───────────────────
    // On desktop browsers e.key === ' '; on Android virtual keyboards it is
    // often 'Unidentified', so the beforeinput handler covers that case.
    if (e.key === ' ') {
        if (handleSpaceMarkdown(editorEl)) {
            e.preventDefault();
            checkFormats();
            return true;
        }
    }

    // ── Arrow key navigation: escape stuck positions in empty blocks ────────
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!sel?.anchorNode) return false;
        const block = closestBlock(sel.anchorNode, editorEl);
        if (!block) return false;

        if (e.key === 'ArrowDown') {
            // If at last block and it's an empty block element, ensure we can move past it
            const next = block.nextElementSibling || block.parentElement?.nextElementSibling;
            if (!next && block.parentElement !== editorEl) {
                // At end of a container (list, blockquote) — create a paragraph after
                const container = block.closest('ul, ol, blockquote');
                if (container && !container.nextElementSibling) {
                    e.preventDefault();
                    const p = document.createElement('p');
                    p.appendChild(document.createElement('br'));
                    container.parentNode?.insertBefore(p, container.nextSibling);

                    const range = document.createRange();
                    range.setStart(p, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    return true;
                }
            }
        }
    }

    return false;
};

/**
 * Handle beforeinput events for markdown auto-formatting.
 *
 * On Android virtual keyboards, keydown often fires with e.key === 'Unidentified'
 * so the space-triggered shortcuts in handleEditorKeyDown never match.
 * The beforeinput event reliably provides the inserted text via event.data,
 * making it the correct hook for Android/mobile IME input.
 *
 * On desktop, if handleEditorKeyDown already handled the space (and called
 * preventDefault), the browser will not fire beforeinput, so there is no
 * double-handling.
 */
export const handleEditorBeforeInput = (
    e: InputEvent,
    editorEl: HTMLElement,
    checkFormats: () => void
): boolean => {
    if (e.inputType === 'insertText' && e.data === ' ') {
        if (handleSpaceMarkdown(editorEl)) {
            e.preventDefault();
            checkFormats();
            return true;
        }
    }
    return false;
};

/**
 * Detect active formatting at the current cursor position.
 * Returns an array of format identifiers matching FormattingToolbar expectations.
 */
export const checkActiveFormats = (editorEl: HTMLElement): string[] => {
    const formats: string[] = [];

    if (document.queryCommandState('bold')) formats.push('bold');
    if (document.queryCommandState('italic')) formats.push('italic');
    if (document.queryCommandState('underline')) formats.push('underline');
    if (document.queryCommandState('strikeThrough')) formats.push('strikethrough');

    const block = document.queryCommandValue('formatBlock');
    if (block === 'h1') formats.push('H1');
    if (block === 'h2') formats.push('H2');

    // Walk up from cursor to detect list/blockquote/code context
    const sel = window.getSelection();
    if (sel?.anchorNode) {
        let el = sel.anchorNode.nodeType === Node.TEXT_NODE
            ? sel.anchorNode.parentElement
            : sel.anchorNode as HTMLElement;
        while (el && el !== editorEl) {
            if (el.tagName === 'UL' && !el.classList.contains('checklist')) formats.push('UL');
            if (el.tagName === 'OL') formats.push('OL');
            if (el.tagName === 'BLOCKQUOTE') formats.push('blockquote');
            if (el.tagName === 'CODE') formats.push('code');
            el = el.parentElement!;
        }
    }

    return formats;
};

/** Toggle inline code: wrap selection in <code> or unwrap if already inside one. */
const toggleCodeFormat = (): void => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const parentCode = (range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as HTMLElement)?.closest('code');

    if (parentCode) {
        // Unwrap code
        const text = parentCode.textContent || '';
        const textNode = document.createTextNode(text);
        parentCode.parentNode?.replaceChild(textNode, parentCode);
        range.selectNodeContents(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
    } else if (!range.collapsed) {
        // Wrap selection in code
        const code = document.createElement('code');
        range.surroundContents(code);
        range.selectNodeContents(code);
        sel.removeAllRanges();
        sel.addRange(range);
    }
};

/** Shallow-compare two format arrays (both are sorted by construction). */
export const formatsEqual = (a: string[], b: string[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

/**
 * Execute a formatting command, handling toggling for block formats.
 */
export const execFormatCommand = (command: string, value?: string) => {
    if (command === 'formatBlock') {
        const currentBlock = document.queryCommandValue('formatBlock');
        if (currentBlock.toLowerCase() === value?.toLowerCase()) {
            document.execCommand('formatBlock', false, 'p');
        } else {
            document.execCommand(command, false, value);
        }
    } else if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
        // execCommand toggles lists natively
        document.execCommand(command);
    } else if (command === 'insertHorizontalRule') {
        document.execCommand('insertHorizontalRule');
    } else if (command === 'code') {
        toggleCodeFormat();
    } else {
        document.execCommand(command, false, value);
    }
};
