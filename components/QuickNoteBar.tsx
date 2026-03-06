import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Paperclip, Hash, Type, Maximize2, Plus, X, FileText, Loader2, CheckSquare } from 'lucide-react';
import { marked } from 'marked';
import { Attachment, QuickNoteState } from '../types';
import { escapeHtml, looksLikeMarkdown, sanitizePastedHtml, hasRichFormatting } from '../utils/editorUtils';
import { processFileInputs } from '../utils/attachmentUtils';
import FormattingToolbar from './FormattingToolbar';
import TagInput from './TagInput';

// Configure marked for clean output
marked.setOptions({ breaks: true, gfm: true });

interface QuickNoteBarProps {
  onSave: (text: string, attachments: Attachment[], tags: string[]) => Promise<void>;
  onExpand: (state: QuickNoteState) => void;
}

export interface QuickNoteBarHandle {
  focus: () => void;
}

interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

const QuickNoteBar = forwardRef<QuickNoteBarHandle, QuickNoteBarProps>(({ onSave, onExpand }, ref) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [isChecklistMode, setIsChecklistMode] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusItemIdRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
  }));

  const checkFormats = useCallback(() => {
    const formats: string[] = [];
    if (document.queryCommandState('bold')) formats.push('bold');
    if (document.queryCommandState('italic')) formats.push('italic');
    if (document.queryCommandState('underline')) formats.push('underline');

    const block = document.queryCommandValue('formatBlock');
    if (block === 'h1') formats.push('H1');
    if (block === 'h2') formats.push('H2');

    setActiveFormats(formats);
  }, []);

  // Selection-based formatting on mobile: show/hide toolbar based on text selection in the editor
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;

    const handleSelectionChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || !editorRef.current) return;

        const anchorNode = selection.anchorNode;
        const isInEditor = anchorNode && editorRef.current.contains(anchorNode);

        if (!selection.isCollapsed && isInEditor) {
          setShowFormatting(true);
          checkFormats();
        } else if (isInEditor && selection.isCollapsed) {
          // Selection collapsed (cursor, no selection) — auto-hide on mobile only
          // On desktop, the toolbar is toggled via the button so don't auto-hide
          setShowFormatting(prev => {
            // Keep visible if it was toggled via the button (desktop behavior)
            // The button toggle sets it explicitly, selection-based is additive
            return prev;
          });
        } else if (!isInEditor) {
          // Selection moved outside editor — hide toolbar
          setShowFormatting(false);
        }
      }, 50);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      clearTimeout(debounceTimer);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [checkFormats]);

  const execFormat = useCallback((command: string, value?: string) => {
    if (command === 'formatBlock') {
      const currentBlock = document.queryCommandValue('formatBlock');
      if (currentBlock.toLowerCase() === value?.toLowerCase()) {
        document.execCommand('formatBlock', false, 'p');
      } else {
        document.execCommand(command, false, value);
      }
    } else {
      document.execCommand(command, false, value);
    }
    editorRef.current?.focus();
    checkFormats();
  }, [checkFormats]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;

    // Handle image paste
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
              name: 'Pasted Image'
            }]);
          };
          reader.readAsDataURL(blob);
        }
        return;
      }
    }

    // Handle text paste
    const html = clipboardData.getData('text/html');
    const plainText = clipboardData.getData('text/plain');

    if (!html && !plainText) return;

    e.preventDefault();

    let htmlToInsert = '';

    if (html && hasRichFormatting(html)) {
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

    setIsEmpty(!editorRef.current?.innerText.trim());
    checkFormats();
  }, [checkFormats]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newAttachments = await processFileInputs(e.target.files);
      setAttachments(prev => [...prev, ...newAttachments]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const resetState = useCallback(() => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setAttachments([]);
    setTags([]);
    setShowTags(false);
    setShowFormatting(false);
    setIsEmpty(true);
    setActiveFormats([]);
    setIsChecklistMode(false);
    setChecklistItems([]);
  }, []);

  const handleSave = useCallback(async () => {
    let content = '';
    if (isChecklistMode) {
      const listItems = checklistItems.map(item =>
        `<li data-checked="${item.checked}">${escapeHtml(item.text)}</li>`
      ).join('');
      content = `<ul class="checklist">${listItems}</ul>`;
    } else {
      const rawContent = editorRef.current?.innerHTML || '';
      content = sanitizePastedHtml(rawContent);
    }

    if ((!content.trim() && attachments.length === 0) || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(content, attachments, tags);
      resetState();
    } catch (error) {
      console.error('Error saving quick note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [isChecklistMode, checklistItems, attachments, tags, isSaving, onSave, resetState]);

  const handleExpand = useCallback(() => {
    let content = '';
    if (isChecklistMode) {
      const listItems = checklistItems.map(item =>
        `<li data-checked="${item.checked}">${escapeHtml(item.text)}</li>`
      ).join('');
      content = `<ul class="checklist">${listItems}</ul>`;
    } else {
      const rawContent = editorRef.current?.innerHTML || '';
      content = sanitizePastedHtml(rawContent);
    }
    onExpand({ content, attachments, tags });
    resetState();
  }, [isChecklistMode, checklistItems, attachments, tags, onExpand, resetState]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

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
          checked: false
        })));
      }
      if (editorRef.current) editorRef.current.innerHTML = '';
      setIsChecklistMode(true);
      setIsEmpty(false);
    }
  }, [isChecklistMode, checklistItems]);

  const updateChecklistItem = useCallback((id: string, text: string) => {
    setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  }, []);

  const addChecklistItem = useCallback((afterId: string) => {
    const newId = crypto.randomUUID();
    focusItemIdRef.current = newId;
    setChecklistItems(prev => {
      const index = prev.findIndex(item => item.id === afterId);
      const newItem = { id: newId, text: '', checked: false };
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

  const toggleChecklistItemChecked = useCallback((id: string) => {
    setChecklistItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
  }, []);

  // Focus the newly added checklist item
  useEffect(() => {
    if (focusItemIdRef.current) {
      const id = focusItemIdRef.current;
      focusItemIdRef.current = null;
      // Use requestAnimationFrame to wait for DOM update
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(`[data-checklist-id="${id}"]`);
        input?.focus();
      });
    }
  }, [checklistItems]);

  const hasContent = !isEmpty || attachments.length > 0 || (isChecklistMode && checklistItems.some(item => item.text.trim()));

  return (
    <div
      className="sticky bottom-0 z-[60] px-3 pb-3 pt-1 lg:w-[34%] lg:mx-auto"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-gray-900/95 backdrop-blur-xl border-2 border-blue-500 rounded-2xl shadow-[0_-4px_30px_rgba(59,130,246,0.15),0_8px_32px_rgba(0,0,0,0.5)]">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {attachments.map((att) => (
                <div key={att.id} className="relative shrink-0 animate-in zoom-in-90 duration-200">
                  {att.type === 'image' ? (
                    <div className="w-12 h-12 rounded-xl overflow-hidden border border-gray-700 bg-black/50">
                      <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-xl border border-gray-700 bg-gray-800/50 flex flex-col items-center justify-center">
                      <FileText size={16} className="text-gray-400" />
                      <span className="text-[8px] text-gray-500 w-full truncate px-1 text-center">{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 bg-gray-800 text-gray-400 hover:text-red-400 border border-gray-600 rounded-full p-0.5 shadow-lg transition-colors active:scale-95"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tag section */}
        {showTags && (
          <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-200">
            <TagInput tags={tags} onTagsChange={setTags} compact />
          </div>
        )}

        {/* Formatting toolbar */}
        {showFormatting && (
          <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-200">
            <FormattingToolbar activeFormats={activeFormats} onFormat={execFormat} compact />
          </div>
        )}

        {/* Text area */}
        <div className="px-4 pt-3 relative">
          {isChecklistMode ? (
            <div className="w-full max-h-[10em] overflow-y-auto bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700 space-y-2">
              {checklistItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                  <div
                    className="shrink-0 cursor-pointer p-0.5"
                    onClick={() => toggleChecklistItemChecked(item.id)}
                  >
                    <div className={`w-5 h-5 border-2 rounded-md flex items-center justify-center transition-colors ${item.checked ? 'border-blue-500 bg-blue-500/20' : 'border-gray-600'}`}>
                      {item.checked && <div className="w-2.5 h-2.5 bg-blue-500 rounded-sm" />}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={item.text}
                    data-checklist-id={item.id}
                    onChange={(e) => updateChecklistItem(item.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSave();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        addChecklistItem(item.id);
                      } else if (e.key === 'Backspace' && item.text === '' && checklistItems.length > 1) {
                        e.preventDefault();
                        removeChecklistItem(item.id);
                      }
                    }}
                    placeholder="List item..."
                    className={`flex-1 bg-transparent text-base text-white placeholder-gray-600 focus:outline-none transition-all text-left ${item.checked ? 'line-through text-gray-500' : ''}`}
                    dir="ltr"
                  />
                </div>
              ))}
              <button
                onClick={() => addChecklistItem(checklistItems[checklistItems.length - 1]?.id)}
                className="flex items-center gap-1.5 text-gray-500 hover:text-blue-400 text-sm transition-colors py-1 active:text-blue-500"
              >
                <Plus size={16} /> Add Item
              </button>
            </div>
          ) : (
            <>
              <div
                ref={editorRef}
                contentEditable
                className="w-full min-h-[1.5em] max-h-[6em] overflow-y-auto bg-gray-800 text-base text-white rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 border border-gray-700 focus:border-gray-600 transition-colors prose prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-1 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:my-1 text-left touch-manipulation"
                dir="ltr"
                onKeyUp={checkFormats}
                onMouseUp={checkFormats}
                onInput={() => setIsEmpty(!editorRef.current?.innerText.trim())}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                suppressContentEditableWarning
              />
              {isEmpty && (
                <div className="absolute top-3 left-7 pointer-events-none text-gray-500 text-base py-2.5">
                  Type a note...
                </div>
              )}
            </>
          )}
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1 px-3 py-2">
          {/* Left group */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors active:scale-95"
            title="Add attachment"
          >
            <Paperclip size={20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
            accept="image/*,.pdf,.txt,.md"
          />

          <button
            onClick={() => setShowTags(prev => !prev)}
            className={`p-2.5 rounded-xl transition-colors active:scale-95 ${showTags ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            title="Tags"
          >
            <Hash size={20} />
          </button>

          <button
            onClick={() => setShowFormatting(prev => !prev)}
            className={`p-2.5 rounded-xl transition-colors active:scale-95 ${showFormatting ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            title="Formatting"
          >
            <Type size={20} />
          </button>

          <button
            onClick={toggleChecklistMode}
            className={`p-2.5 rounded-xl transition-colors active:scale-95 ${isChecklistMode ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            title="Checklist Mode"
          >
            <CheckSquare size={20} />
          </button>

          <button
            onClick={handleExpand}
            className="p-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors active:scale-95"
            title="Expand to full editor"
          >
            <Maximize2 size={20} />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Save CTA */}
          <button
            onClick={handleSave}
            disabled={!hasContent || isSaving}
            className={`p-2.5 rounded-xl transition-all active:scale-95 ${
              hasContent && !isSaving
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-900/30'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
            title="Save note (⌘+Enter)"
          >
            {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} strokeWidth={3} />}
          </button>
        </div>
      </div>
    </div>
  );
});

QuickNoteBar.displayName = 'QuickNoteBar';

export default QuickNoteBar;
