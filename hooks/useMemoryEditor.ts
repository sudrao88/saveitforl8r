import { useState, useRef, useCallback, useEffect } from 'react';
import { marked } from 'marked';
import { Attachment } from '../types';
import { ChecklistItemData } from '../components/ChecklistItems';
import {
  escapeHtml,
  looksLikeMarkdown,
  parseChecklistMarkdown,
  sanitizePastedHtml,
  hasRichFormatting,
  containsUrl,
  linkifyUrls,
  handleEditorKeyDown,
  checkActiveFormats,
  execFormatCommand,
  formatsEqual,
  isEditorEmpty,
} from '../utils/editorUtils';
import { processFileInputs } from '../utils/attachmentUtils';
import useBeforeInputMarkdown from './useBeforeInputMarkdown';

// Configure marked for clean output with line-break support
marked.setOptions({ breaks: true, gfm: true });

export interface UseMemoryEditorOptions {
  initialContent?: string;
  initialAttachments?: Attachment[];
  initialTags?: string[];
}

export interface UseMemoryEditorReturn {
  // Refs
  editorRef: React.RefObject<HTMLDivElement | null>;

  // Editor state
  activeFormats: string[];
  isEmpty: boolean;
  isChecklistMode: boolean;
  checklistItems: ChecklistItemData[];
  setChecklistItems: React.Dispatch<React.SetStateAction<ChecklistItemData[]>>;

  // Attachments & tags
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;

  // Panel toggles
  showTags: boolean;
  setShowTags: React.Dispatch<React.SetStateAction<boolean>>;
  showFormatting: boolean;
  setShowFormatting: React.Dispatch<React.SetStateAction<boolean>>;
  showAttachMenu: boolean;
  setShowAttachMenu: React.Dispatch<React.SetStateAction<boolean>>;

  // Handlers
  checkFormats: () => void;
  execFormat: (command: string, value?: string) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleEditorKeyDown: (e: React.KeyboardEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeAttachment: (id: string) => void;
  closeAttachMenu: () => void;
  toggleChecklistMode: () => void;
  updateChecklistItem: (id: string, text: string) => void;
  addChecklistItem: (afterId?: string) => void;
  removeChecklistItem: (id: string) => void;

  // Content helpers
  getEditorContent: () => string;
  setEditorHTML: (html: string) => void;
  resetEditor: () => void;
  setIsEmpty: React.Dispatch<React.SetStateAction<boolean>>;
  setIsChecklistMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMemoryEditor(options: UseMemoryEditorOptions = {}): UseMemoryEditorReturn {
  const {
    initialContent = '',
    initialAttachments = [],
    initialTags = [],
  } = options;

  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const formatRafRef = useRef<number>(0);
  const prevFormatsRef = useRef<string[]>([]);

  // Editor state
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [isEmpty, setIsEmpty] = useState(() => !initialContent);
  const [isChecklistMode, setIsChecklistMode] = useState(() =>
    initialContent.startsWith('<ul class="checklist">')
  );
  const [checklistItems, setChecklistItems] = useState<ChecklistItemData[]>(() => {
    if (initialContent.startsWith('<ul class="checklist">')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(initialContent, 'text/html');
      const items = Array.from(doc.querySelectorAll('li'));
      return items.map(item => ({
        id: crypto.randomUUID(),
        text: item.textContent || '',
        checked: item.getAttribute('data-checked') === 'true',
      }));
    }
    return [];
  });

  // Attachments & tags
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [tags, setTags] = useState<string[]>(initialTags);

  // Panel toggles
  const [showTags, setShowTags] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // rAF-debounced format checking
  const checkFormats = useCallback(() => {
    cancelAnimationFrame(formatRafRef.current);
    formatRafRef.current = requestAnimationFrame(() => {
      if (!editorRef.current) return;
      const formats = checkActiveFormats(editorRef.current);
      if (!formatsEqual(formats, prevFormatsRef.current)) {
        prevFormatsRef.current = formats;
        setActiveFormats(formats);
      }
      setIsEmpty(isEditorEmpty(editorRef.current));
    });
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(formatRafRef.current), []);

  // Markdown auto-formatting via beforeinput
  useBeforeInputMarkdown(editorRef, checkFormats);

  // Format command execution
  const execFormat = useCallback((command: string, value?: string) => {
    execFormatCommand(command, value);
    editorRef.current?.focus();
    checkFormats();
  }, [checkFormats]);

  // Paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;

    // Handle image paste — add as attachment
    for (const item of clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (evt) => {
            setAttachments(prev => [...prev, {
              id: crypto.randomUUID(),
              type: 'image',
              mimeType: blob.type,
              data: evt.target?.result as string,
              name: 'Pasted Image',
            }]);
          };
          reader.readAsDataURL(blob);
        }
        return;
      }
    }

    // Handle text paste — preserve rich formatting or convert markdown
    const html = clipboardData.getData('text/html');
    const plainText = clipboardData.getData('text/plain');

    if (!html && !plainText) return;

    e.preventDefault();

    let htmlToInsert = '';

    // Checklist markdown — switch to checklist mode with parsed items
    if (plainText) {
      const parsedChecklist = parseChecklistMarkdown(plainText);
      if (parsedChecklist) {
        setChecklistItems(parsedChecklist.map(item => ({
          id: crypto.randomUUID(),
          text: item.text,
          checked: item.checked,
        })));
        if (editorRef.current) editorRef.current.innerHTML = '';
        setIsChecklistMode(true);
        setShowFormatting(false);
        setIsEmpty(false);
        return;
      }
    }

    if (plainText && containsUrl(plainText)) {
      htmlToInsert = linkifyUrls(escapeHtml(plainText).replace(/\n/g, '<br>'));
    } else if (html && hasRichFormatting(html)) {
      htmlToInsert = sanitizePastedHtml(html);
    } else if (plainText && looksLikeMarkdown(plainText)) {
      htmlToInsert = sanitizePastedHtml(marked.parse(plainText) as string);
    } else if (plainText) {
      htmlToInsert = escapeHtml(plainText).replace(/\n/g, '<br>');
    }

    if (htmlToInsert) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const fragment = range.createContextualFragment(htmlToInsert);
        range.insertNode(fragment);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    setIsEmpty(isEditorEmpty(editorRef.current));
    checkFormats();
  }, [checkFormats]);

  // Editor keydown handler (rich text auto-formatting)
  const handleEditorKeyDownWrapper = useCallback((e: React.KeyboardEvent) => {
    if (editorRef.current) {
      handleEditorKeyDown(e, editorRef.current, checkFormats);
    }
  }, [checkFormats]);

  // File selection handler
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newAttachments = await processFileInputs(e.target.files);
      setAttachments(prev => [...prev, ...newAttachments]);
      e.target.value = '';
    }
  }, []);

  // Attachment removal
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Close attachment menu
  const closeAttachMenu = useCallback(() => setShowAttachMenu(false), []);

  // Toggle checklist mode
  const toggleChecklistMode = useCallback(() => {
    if (isChecklistMode) {
      // Switch back to rich text: put checklist text into the editor
      const text = checklistItems.map(item => escapeHtml(item.text)).join('<br>');
      if (editorRef.current) {
        editorRef.current.innerHTML = text;
        setIsEmpty(!text);
      }
      setChecklistItems([]);
      setIsChecklistMode(false);
    } else {
      // Switch to checklist mode: convert editor text to checklist items
      const text = editorRef.current?.innerText || '';
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) {
        setChecklistItems([{ id: crypto.randomUUID(), text: '', checked: false }]);
      } else {
        setChecklistItems(lines.map(line => ({
          id: crypto.randomUUID(),
          text: line,
          checked: false,
        })));
      }
      if (editorRef.current) editorRef.current.innerHTML = '';
      setIsChecklistMode(true);
      setIsEmpty(false);
      setShowFormatting(false);
    }
  }, [isChecklistMode, checklistItems]);

  // Checklist CRUD
  const updateChecklistItem = useCallback((id: string, text: string) => {
    setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  }, []);

  const addChecklistItem = useCallback((afterId?: string) => {
    setChecklistItems(prev => {
      const index = prev.findIndex(item => item.id === afterId);
      const newItem = { id: crypto.randomUUID(), text: '', checked: false };
      if (index === -1) return [...prev, newItem];
      const newItems = [...prev];
      newItems.splice(index + 1, 0, newItem);
      return newItems;
    });
  }, []);

  const removeChecklistItem = useCallback((id: string) => {
    setChecklistItems(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter(item => item.id !== id);
    });
  }, []);

  // Get current editor content as HTML string
  const getEditorContent = useCallback((): string => {
    if (isChecklistMode) {
      const listItems = checklistItems.map(item =>
        `<li data-checked="${item.checked}">${escapeHtml(item.text)}</li>`
      ).join('');
      return checklistItems.length > 0 ? `<ul class="checklist">${listItems}</ul>` : '';
    }
    return editorRef.current?.innerHTML || '';
  }, [isChecklistMode, checklistItems]);

  // Set editor DOM content directly
  const setEditorHTML = useCallback((html: string) => {
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      setIsEmpty(!html);
    }
  }, []);

  // Reset all editor state
  const resetEditor = useCallback(() => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setAttachments([]);
    setTags([]);
    setShowTags(false);
    setShowFormatting(false);
    setShowAttachMenu(false);
    setIsEmpty(true);
    setActiveFormats([]);
    setIsChecklistMode(false);
    setChecklistItems([]);
  }, []);

  return {
    editorRef,
    activeFormats,
    isEmpty,
    isChecklistMode,
    checklistItems,
    setChecklistItems,
    attachments,
    setAttachments,
    tags,
    setTags,
    showTags,
    setShowTags,
    showFormatting,
    setShowFormatting,
    showAttachMenu,
    setShowAttachMenu,
    checkFormats,
    execFormat,
    handlePaste,
    handleEditorKeyDown: handleEditorKeyDownWrapper,
    handleFileSelect,
    removeAttachment,
    closeAttachMenu,
    toggleChecklistMode,
    updateChecklistItem,
    addChecklistItem,
    removeChecklistItem,
    getEditorContent,
    setEditorHTML,
    resetEditor,
    setIsEmpty,
    setIsChecklistMode,
  };
}
