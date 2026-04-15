import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Paperclip, Hash, Type, Maximize2, Plus, X, FileText, Loader2, CheckSquare, Check } from 'lucide-react';
import AttachmentMenu from './AttachmentMenu';
import { marked } from 'marked';
import { Attachment, QuickNoteState } from '../types';
import { escapeHtml, looksLikeMarkdown, parseChecklistMarkdown, sanitizePastedHtml, hasRichFormatting, extractHashtags, mergeTagsWithHashtags, containsUrl, linkifyUrls, handleEditorKeyDown, checkActiveFormats, execFormatCommand, formatsEqual, isEditorEmpty } from '../utils/editorUtils';
import { processFileInputs, MAX_FILE_SIZE_BYTES, MAX_ATTACHMENTS } from '../utils/attachmentUtils';
import { triggerHaptic } from '../services/platform';
import FormattingToolbar from './FormattingToolbar';
import TagInput from './TagInput';
import { btn, zIndex } from '../styles/design-system';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { ChecklistEditor, ChecklistItemData, serializeChecklistToHtml, cascadeToggle, canIndent, canOutdent } from './ChecklistItems';
import useBeforeInputMarkdown from '../hooks/useBeforeInputMarkdown';

// Configure marked for clean output
marked.setOptions({ breaks: true, gfm: true });

interface QuickNoteBarProps {
  onSave: (text: string, attachments: Attachment[], tags: string[]) => Promise<void>;
  onExpand: (state: QuickNoteState) => void;
}

export interface QuickNoteBarHandle {
  focus: () => void;
  triggerCamera: () => void;
  triggerDocument: () => void;
  setContent: (text: string, attachments: Attachment[]) => void;
}

// ChecklistItemData imported from ./ChecklistItems

const QuickNoteBar = forwardRef<QuickNoteBarHandle, QuickNoteBarProps>(({ onSave, onExpand }, ref) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [isChecklistMode, setIsChecklistMode] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemData[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<{ name: string; size: number }[]>([]);

  const keyboardHeight = useKeyboardHeight({ includeOffsetTop: true });

  const editorRef = useRef<HTMLDivElement>(null);
  const focusItemIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formatRafRef = useRef<number>(0);
  const prevFormatsRef = useRef<string[]>([]);
  const widgetCameraRef = useRef<HTMLInputElement>(null);
  const widgetDocRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
      cancelAnimationFrame(formatRafRef.current);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    triggerCamera: () => widgetCameraRef.current?.click(),
    triggerDocument: () => widgetDocRef.current?.click(),
    setContent: (text: string, newAttachments: Attachment[]) => {
      // Reset checklist mode so shared content is visible in rich-text editor
      setIsChecklistMode(false);
      setChecklistItems([]);
      if (editorRef.current) {
        editorRef.current.innerHTML = escapeHtml(text || '').replace(/\n/g, '<br>');
        setIsEmpty(!text);
      }
      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments]);
      }
      editorRef.current?.focus();
    },
  }));

  // Autofocus the editor on mount for devices with a fine pointer (keyboard-attached)
  // This avoids triggering the virtual keyboard on touch-only mobile devices
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) {
      editorRef.current?.focus();
    }
  }, []);

  // rAF-debounced format checking — coalesces multiple calls per frame and
  // skips re-renders when the active formats haven't actually changed.
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

  useBeforeInputMarkdown(editorRef, checkFormats);

  const execFormat = useCallback((command: string, value?: string) => {
    execFormatCommand(command, value);
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

    // Checklist markdown — switch to checklist mode with parsed items
    if (plainText) {
        const parsedChecklist = parseChecklistMarkdown(plainText);
        if (parsedChecklist) {
            setChecklistItems(parsedChecklist.map(item => ({
                id: crypto.randomUUID(),
                text: item.text,
                checked: item.checked,
                indent: (item as { indent?: number }).indent ?? 0,
            })));
            if (editorRef.current) editorRef.current.innerHTML = '';
            setIsChecklistMode(true);
            setIsEmpty(false);
            setShowFormatting(false);
            return;
        }
    }

    if (plainText && containsUrl(plainText)) {
      // Prefer plain text when it contains URLs — clipboard HTML from messaging
      // apps often wraps URLs in preview cards that lose the actual URL text
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

  const closeAttachMenu = useCallback(() => setShowAttachMenu(false), []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { attachments: newAttachments, rejected } = await processFileInputs(e.target.files);
      setAttachments(prev => {
        const remaining = MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) return prev;
        return [...prev, ...newAttachments.slice(0, remaining)];
      });
      if (rejected.length > 0) {
        setRejectedFiles(rejected);
        setTimeout(() => setRejectedFiles([]), 5000);
      }
      e.target.value = '';
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
    setShowAttachMenu(false);
    setIsEmpty(true);
    setActiveFormats([]);
    setIsChecklistMode(false);
    setChecklistItems([]);
  }, []);

  const handleSave = useCallback(async () => {
    let content = '';
    if (isChecklistMode) {
      content = serializeChecklistToHtml(checklistItems);
    } else {
      const rawContent = editorRef.current?.innerHTML || '';
      content = sanitizePastedHtml(rawContent);
    }

    if ((!content.trim() && attachments.length === 0) || isSaving) return;

    setIsSaving(true);
    try {
      const extractedTags = extractHashtags(content);
      const allTags = mergeTagsWithHashtags(tags, extractedTags);
      await onSave(content, attachments, allTags);
      resetState();
      setSaveSuccess(true);
      triggerHaptic();
      if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
      saveSuccessTimeoutRef.current = setTimeout(() => {
        saveSuccessTimeoutRef.current = null;
        setSaveSuccess(false);
      }, 600);
    } catch (error) {
      console.error('Error saving quick note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [isChecklistMode, checklistItems, attachments, tags, isSaving, onSave, resetState]);

  const handleExpand = useCallback(() => {
    let content = '';
    if (isChecklistMode) {
      content = serializeChecklistToHtml(checklistItems);
    } else {
      const rawContent = editorRef.current?.innerHTML || '';
      content = sanitizePastedHtml(rawContent);
    }
    onExpand({ content, attachments, tags });
    resetState();
  }, [isChecklistMode, checklistItems, attachments, tags, onExpand, resetState]);

  // Explicitly focus the editor on touch/click to work around iOS standalone
  // mode where the first tap on a contentEditable after a cold launch may not
  // trigger the virtual keyboard. Skip if user has an active text selection
  // to avoid disrupting drag-select on mobile.
  const handleEditorTap = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString()) return; // Don't disrupt active selection
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
      return;
    }
    // Rich text auto-formatting
    if (editorRef.current) {
      handleEditorKeyDown(e, editorRef.current, checkFormats);
    }
  }, [handleSave, checkFormats]);

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
      setShowFormatting(false);
      // Focus the last checklist input after render so the keyboard stays open
      requestAnimationFrame(() => {
        const inputs = containerRef.current?.querySelectorAll<HTMLInputElement>('[data-checklist-id]');
        if (inputs?.length) inputs[inputs.length - 1].focus();
      });
    }
  }, [isChecklistMode, checklistItems]);

  const updateChecklistItem = useCallback((id: string, text: string) => {
    setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  }, []);

  const addChecklistItem = useCallback((afterId?: string) => {
    const newId = crypto.randomUUID();
    focusItemIdRef.current = newId;
    setChecklistItems(prev => {
      const index = prev.findIndex(item => item.id === afterId);
      const inheritIndent = index !== -1 ? (prev[index].indent ?? 0) : 0;
      const newItem: ChecklistItemData = { id: newId, text: '', checked: false, indent: inheritIndent };
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
    setChecklistItems(prev => cascadeToggle(prev, id));
  }, []);

  const indentChecklistItem = useCallback((id: string) => {
    setChecklistItems(prev => {
      if (!canIndent(prev, id)) return prev;
      return prev.map(i => i.id === id ? { ...i, indent: 1 } : i);
    });
  }, []);

  const outdentChecklistItem = useCallback((id: string) => {
    setChecklistItems(prev => {
      if (!canOutdent(prev, id)) return prev;
      return prev.map(i => i.id === id ? { ...i, indent: 0 } : i);
    });
  }, []);

  // Focus the newly added checklist item
  useEffect(() => {
    if (focusItemIdRef.current) {
      const id = focusItemIdRef.current;
      focusItemIdRef.current = null;
      // Use requestAnimationFrame to wait for DOM update
      requestAnimationFrame(() => {
        const input = containerRef.current?.querySelector<HTMLInputElement>(`[data-checklist-id="${id}"]`);
        input?.focus();
      });
    }
  }, [checklistItems]);

  const hasContent = !isEmpty || attachments.length > 0 || (isChecklistMode && checklistItems.some(item => item.text.trim()));

  return (
    <div
      ref={containerRef}
      className={`${keyboardHeight > 0 ? 'fixed left-0 right-0' : 'sticky'} bottom-0 z-(--z-modal) px-3 pb-3 pt-1 lg:w-[34%] lg:mx-auto transition-[bottom] duration-(--duration-fast) ease-out`}
      style={{
        paddingBottom: keyboardHeight > 0 ? '0.75rem' : 'max(0.75rem, var(--sab))',
        bottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined,
      }}
    >
      <div className="bg-(--color-surface-overlay)/95 backdrop-blur-xl border-2 border-(--color-accent) rounded-(--radius-xl) shadow-[0_0_16px_rgba(156,163,175,0.3)]">
        {/* File too large warning */}
        {rejectedFiles.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-start gap-2 text-xs text-(--color-danger) bg-(--color-danger)/10 border border-(--color-danger)/30 rounded-(--radius-md) px-3 py-2">
              <span className="shrink-0 mt-0.5">
                <X size={12} />
              </span>
              <span>
                {rejectedFiles.length === 1
                  ? `"${rejectedFiles[0].name}" exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`
                  : `${rejectedFiles.length} files exceed the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`}
              </span>
            </div>
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {attachments.map((att) => (
                <div key={att.id} className="relative shrink-0 animate-in zoom-in-90 duration-(--duration-fast)">
                  {att.type === 'image' ? (
                    <div className="w-12 h-12 rounded-(--radius-xl) overflow-hidden border border-(--color-border-default) bg-black/50">
                      <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-(--radius-xl) border border-(--color-border-default) bg-(--color-surface-raised)/50 flex flex-col items-center justify-center">
                      <FileText size={16} className="text-(--color-text-secondary)" />
                      <span className="text-xs text-(--color-text-tertiary) w-full truncate px-1 text-center">{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 bg-(--color-surface-raised) text-(--color-text-secondary) hover:text-(--color-danger) border border-(--color-border-default) rounded-(--radius-full) p-0.5 shadow-lg transition-colors duration-(--duration-fast) active:scale-95"
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
          <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-(--duration-fast)">
            <TagInput tags={tags} onTagsChange={setTags} compact />
          </div>
        )}

        {/* Formatting toolbar */}
        {showFormatting && (
          <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-(--duration-fast)">
            <FormattingToolbar activeFormats={activeFormats} onFormat={execFormat} compact />
          </div>
        )}

        {/* Text area */}
        <div className="px-4 pt-3 relative">
          {isChecklistMode ? (
            <div className="w-full max-h-[10em] overflow-y-auto bg-(--color-surface-raised) rounded-(--radius-xl) px-3 py-2.5 border border-(--color-border-default)">
              <ChecklistEditor
                items={checklistItems}
                onToggle={toggleChecklistItemChecked}
                onUpdate={updateChecklistItem}
                onAdd={addChecklistItem}
                onRemove={removeChecklistItem}
                onIndent={indentChecklistItem}
                onOutdent={outdentChecklistItem}
                onSave={handleSave}
                dataIdAttr
              />
            </div>
          ) : (
            <>
              <div
                ref={editorRef}
                contentEditable
                tabIndex={0}
                role="textbox"
                className="w-full min-h-[1.5em] max-h-[6em] overflow-y-auto bg-(--color-surface-raised) text-base text-(--color-text-primary) rounded-(--radius-xl) px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-(--color-accent)/40 border border-(--color-border-default) focus:border-(--color-accent)/50 transition-colors prose prose-invert max-w-none rich-editor rich-editor--compact text-left touch-manipulation"
                dir="ltr"
                onClick={handleEditorTap}
                onKeyUp={checkFormats}
                onMouseUp={checkFormats}
                onInput={checkFormats}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                suppressContentEditableWarning
              />
              {isEmpty && (
                <div className="absolute top-3 left-7 pointer-events-none text-(--color-text-tertiary) text-base py-2.5">
                  Type a note...
                </div>
              )}
            </>
          )}
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1 px-3 py-2">
          {/* Left group */}
          <div className="relative">
            <button
              onClick={() => setShowAttachMenu(prev => !prev)}
              onMouseDown={(e) => e.preventDefault()}
              className={btn.iconLg}
              title="Add attachment"
            >
              <Paperclip size={20} />
            </button>
            <AttachmentMenu
              open={showAttachMenu}
              onClose={closeAttachMenu}
              onFileSelect={handleFileSelect}
            />
          </div>

          <button
            onClick={() => setShowTags(prev => !prev)}
            onMouseDown={(e) => e.preventDefault()}
            className={`${btn.iconLg} ${showTags ? 'bg-(--color-accent) text-(--color-text-primary)' : ''}`}
            title="Tags"
          >
            <Hash size={20} />
          </button>

          {!isChecklistMode && (
            <button
              onClick={() => setShowFormatting(prev => !prev)}
              onMouseDown={(e) => e.preventDefault()}
              className={`${btn.iconLg} ${showFormatting ? 'bg-(--color-accent) text-(--color-text-primary)' : ''}`}
              title="Formatting"
            >
              <Type size={20} />
            </button>
          )}

          <button
            onClick={toggleChecklistMode}
            onMouseDown={(e) => e.preventDefault()}
            className={`${btn.iconLg} ${isChecklistMode ? 'bg-(--color-accent) text-(--color-text-primary)' : ''}`}
            title="Checklist Mode"
          >
            <CheckSquare size={20} />
          </button>

          <button
            onClick={handleExpand}
            onMouseDown={(e) => e.preventDefault()}
            className={btn.iconLg}
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
            className={`${btn.base} ${
              saveSuccess
                ? btn.ctaSuccess
                : hasContent && !isSaving
                  ? btn.cta
                  : btn.ctaDisabled
            }`}
            title="Save note (⌘+Enter)"
          >
            {isSaving ? <Loader2 size={20} className="animate-spin" /> : saveSuccess ? <Check size={20} strokeWidth={3} /> : <Plus size={20} strokeWidth={3} />}
          </button>
        </div>
      </div>

      {/* Hidden file inputs for widget-triggered captures (camera/document) */}
      <input
        type="file"
        ref={widgetCameraRef}
        onChange={handleFileSelect}
        className="hidden"
        accept="image/*"
        capture="environment"
      />
      <input
        type="file"
        ref={widgetDocRef}
        onChange={handleFileSelect}
        className="hidden"
        multiple
        accept=".pdf,.txt,.md"
      />
    </div>
  );
});

QuickNoteBar.displayName = 'QuickNoteBar';

export default QuickNoteBar;
