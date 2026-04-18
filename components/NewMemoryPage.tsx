import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import { Send, Paperclip, Hash, Type, FileText, X, Loader2, ArrowLeft, CheckSquare, Plus, AlertTriangle } from 'lucide-react';
import AttachmentMenu from './AttachmentMenu';
import { marked } from 'marked';
import { Attachment, Memory } from '../types';
import { isNative } from '../services/platform';
import { Keyboard } from '@capacitor/keyboard';
import { Geolocation } from '@capacitor/geolocation';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useDeferredAutoFocus } from '../hooks/useDeferredAutoFocus';
import { escapeHtml, looksLikeMarkdown, parseChecklistMarkdown, sanitizePastedHtml, hasRichFormatting, extractHashtags, mergeTagsWithHashtags, containsUrl, linkifyUrls, handleEditorKeyDown, checkActiveFormats, execFormatCommand, formatsEqual, isEditorEmpty } from '../utils/editorUtils';
import { processFileInputs, MAX_FILE_SIZE_BYTES, MAX_ATTACHMENTS } from '../utils/attachmentUtils';
import FormattingToolbar from './FormattingToolbar';
import TagInput from './TagInput';
import { btn, overlay } from '../styles/design-system';
import { ChecklistEditor, ChecklistItemData, serializeChecklistToHtml, parseChecklistFromHtml, cascadeToggle, applyIndent, applyOutdent, applyMove } from './ChecklistItems';
import useBeforeInputMarkdown from '../hooks/useBeforeInputMarkdown';

interface NewMemoryPageProps {
  onClose: () => void;
  onCreate: (
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => Promise<void>;
  onUpdate?: (
    id: string,
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => Promise<void>;
  initialContent?: {
    text: string;
    attachments: Attachment[];
    tags?: string[];
    checkClipboard?: boolean;
  };
  editMemory?: Memory;
}

// Configure marked for clean output with line-break support
marked.setOptions({ breaks: true, gfm: true });

const NewMemoryPage: React.FC<NewMemoryPageProps> = ({ onClose, onCreate, onUpdate, initialContent, editMemory }) => {
  const isEditMode = !!editMemory;

  // Get initial values for edit mode
  const getInitialAttachments = (): Attachment[] => {
    if (editMemory?.attachments) return [...editMemory.attachments];
    if (initialContent?.attachments) return initialContent.attachments;
    return [];
  };

  const getInitialTags = (): string[] => {
    if (editMemory?.tags) return [...editMemory.tags];
    if (initialContent?.tags) return [...initialContent.tags];
    return [];
  };

  const getInitialContent = (): string => {
    if (editMemory?.content) return editMemory.content;
    if (initialContent?.text) return initialContent.text;
    return '';
  };

  const [attachments, setAttachments] = useState<Attachment[]>(getInitialAttachments);
  const [tags, setTags] = useState<string[]>(getInitialTags);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Store initial values for change detection
  const initialValuesRef = useRef({
    content: getInitialContent(),
    attachments: JSON.stringify(getInitialAttachments().map(a => a.id).sort()),
    tags: JSON.stringify([...getInitialTags()].sort())
  });

  // Editor States
  const [isChecklistMode, setIsChecklistMode] = useState(() => {
    const content = getInitialContent();
    return content.startsWith('<ul class="checklist">');
  });
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [isEmpty, setIsEmpty] = useState(() => !getInitialContent());

  // Bottom card panel toggles
  const [showTags, setShowTags] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<{ name: string; size: number }[]>([]);
  const [droppedForLimit, setDroppedForLimit] = useState(0);

  // Dismiss discard confirmation on Android back button
  useBackButton(() => setShowDiscardConfirm(false), showDiscardConfirm);

  // For Rich Text Mode
  const editorRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const pendingEditorContent = useRef<string | null>(null);
  const formatRafRef = useRef<number>(0);
  const prevFormatsRef = useRef<string[]>([]);

  // For Checklist Mode
  const [checklistItems, setChecklistItems] = useState<ChecklistItemData[]>(() => {
    const content = getInitialContent();
    if (content.startsWith('<ul class="checklist">')) {
      return parseChecklistFromHtml(content);
    }
    return [];
  });

  // Hook updates the global --kb-inset CSS variable used by the sticky bottom
  // card below; we don't need the returned height in JSX.
  useKeyboardHeight();

  useEffect(() => {
    // Ensure keyboard pushes content up on native
    if (isNative()) {
      Keyboard.setAccessoryBarVisible({ isVisible: true });
      Keyboard.setScroll({ isDisabled: false });
    }
  }, []);

  // Populate editor content: pending mode-switch content takes priority, then one-time init
  useEffect(() => {
    if (isChecklistMode || !editorRef.current) return;

    if (pendingEditorContent.current !== null) {
        editorRef.current.innerHTML = pendingEditorContent.current;
        setIsEmpty(!pendingEditorContent.current);
        pendingEditorContent.current = null;
        isInitialized.current = true;
        return;
    }

    if (!isInitialized.current) {
        let initialText = '';
        if (editMemory?.content && !editMemory.content.startsWith('<ul class="checklist">')) {
            initialText = editMemory.content;
        } else if (initialContent?.text) {
            initialText = initialContent.text.replace(/\n/g, '<br>');
        }
        editorRef.current.innerHTML = initialText;
        setIsEmpty(!initialText);
        isInitialized.current = true;
    }
  }, [isChecklistMode, initialContent, editMemory]);

  useDeferredAutoFocus(editorRef, { enabled: !isChecklistMode });

  const handlePaste = (e: React.ClipboardEvent) => {
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
                        name: 'Pasted Image'
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
                indent: (item as { indent?: number }).indent ?? 0,
            })));
            if (editorRef.current) editorRef.current.innerHTML = '';
            setIsChecklistMode(true);
            setShowFormatting(false);
            setIsEmpty(false);
            return;
        }
    }

    if (plainText && containsUrl(plainText)) {
        // Prefer plain text when it contains URLs — clipboard HTML from messaging
        // apps often wraps URLs in preview cards that lose the actual URL text
        htmlToInsert = linkifyUrls(escapeHtml(plainText).replace(/\n/g, '<br>'));
    } else if (html && hasRichFormatting(html)) {
        // Rich text paste (Word, Google Docs, web pages) — sanitize & preserve formatting
        htmlToInsert = sanitizePastedHtml(html);
    } else if (plainText && looksLikeMarkdown(plainText)) {
        // Plain text with markdown syntax — convert to HTML, then sanitize to prevent XSS
        htmlToInsert = sanitizePastedHtml(marked.parse(plainText) as string);
    } else if (plainText) {
        // Plain text without markdown — insert with line breaks preserved
        htmlToInsert = escapeHtml(plainText).replace(/\n/g, '<br>');
    }

    if (htmlToInsert) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const fragment = range.createContextualFragment(htmlToInsert);
            range.insertNode(fragment);
            // Move cursor to end of inserted content
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    setIsEmpty(isEditorEmpty(editorRef.current));
    checkFormats();
  };

  const closeAttachMenu = () => setShowAttachMenu(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { attachments: newAttachments, rejected } = await processFileInputs(e.target.files);
      let dropped = 0;
      setAttachments(prev => {
        const remaining = Math.max(0, MAX_ATTACHMENTS - prev.length);
        dropped = Math.max(0, newAttachments.length - remaining);
        if (remaining <= 0) return prev;
        return [...prev, ...newAttachments.slice(0, remaining)];
      });
      if (rejected.length > 0) {
        setRejectedFiles(rejected);
        setTimeout(() => setRejectedFiles([]), 5000);
      }
      if (dropped > 0) {
        setDroppedForLimit(dropped);
        setTimeout(() => setDroppedForLimit(0), 5000);
      }
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };


  // Rich Text Formatting — rAF-debounced to coalesce multiple calls per frame
  const checkFormats = () => {
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
  };

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(formatRafRef.current), []);

  useBeforeInputMarkdown(editorRef, checkFormats);

  const execFormat = (command: string, value?: string) => {
      execFormatCommand(command, value);
      editorRef.current?.focus();
      checkFormats();
  };

  const handleFormat = (command: string, value?: string) => {
    execFormat(command, value);
  };

  // Toggle Checklist Mode
  const toggleChecklistMode = () => {
      if (isChecklistMode) {
          const text = checklistItems.map(item => escapeHtml(item.text)).join('<br>');
          pendingEditorContent.current = text;
          setIsChecklistMode(false);
      } else {
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
          // Clear editor content before switching so the browser-managed
          // contentEditable text doesn't persist in the reused DOM node.
          if (editorRef.current) {
              editorRef.current.innerHTML = '';
          }
          setIsChecklistMode(true);
          setShowFormatting(false);
      }
  };

  const updateChecklistItem = (id: string, text: string) => {
      setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  };

  const addChecklistItem = (afterId?: string) => {
      setChecklistItems(prev => {
          const index = prev.findIndex(item => item.id === afterId);
          const inheritIndent = index !== -1 ? (prev[index].indent ?? 0) : 0;
          const newItem: ChecklistItemData = { id: crypto.randomUUID(), text: '', checked: false, indent: inheritIndent };
          if (index === -1) return [...prev, newItem];
          const newItems = [...prev];
          newItems.splice(index + 1, 0, newItem);
          return newItems;
      });
  };
  
  const removeChecklistItem = (id: string) => {
      if (checklistItems.length <= 1) return;
      setChecklistItems(prev => prev.filter(item => item.id !== id));
  };

  const toggleChecklistItemChecked = (id: string) => {
      setChecklistItems(prev => cascadeToggle(prev, id));
  };

  const indentChecklistItem = (id: string) => {
      setChecklistItems(prev => applyIndent(prev, id));
  };

  const outdentChecklistItem = (id: string) => {
      setChecklistItems(prev => applyOutdent(prev, id));
  };

  const moveChecklistItem = useCallback((id: string, direction: 'up' | 'down') => {
      setChecklistItems(prev => applyMove(prev, id, direction));
  }, []);

  // Check if there are unsaved changes
  const hasChanges = useCallback((): boolean => {
    // Get current content
    let currentContent = '';
    if (isChecklistMode) {
      currentContent = checklistItems.length > 0 ? serializeChecklistToHtml(checklistItems) : '';
    } else {
      currentContent = editorRef.current?.innerHTML || '';
    }

    // Compare content
    if (currentContent !== initialValuesRef.current.content) return true;

    // Compare attachments
    const currentAttachments = JSON.stringify(attachments.map(a => a.id).sort());
    if (currentAttachments !== initialValuesRef.current.attachments) return true;

    // Compare tags
    const currentTags = JSON.stringify([...tags].sort());
    if (currentTags !== initialValuesRef.current.tags) return true;

    return false;
  }, [isChecklistMode, checklistItems, attachments, tags]);

  const handleSubmit = async () => {
    let finalContent = '';

    if (isChecklistMode) {
        finalContent = serializeChecklistToHtml(checklistItems);
    } else {
        finalContent = editorRef.current?.innerHTML || '';
    }

    if ((!finalContent.trim() && attachments.length === 0) || isProcessing) return;

    setIsProcessing(true);

    try {
      let location: { latitude: number; longitude: number; accuracy?: number } | undefined;

      // Only fetch location for new memories, not edits
      if (!isEditMode) {
        try {
          if (isNative()) {
            // Use Capacitor Geolocation plugin on native to trigger the
            // iOS "While Using App" permission dialog and access native GPS
            const pos = await Promise.race([
              Geolocation.getCurrentPosition({ timeout: 5000 }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            if (pos) {
              location = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              };
            }
          } else if (navigator.geolocation) {
            const pos = await Promise.race([
              new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
            ]) as GeolocationPosition | null;
            if (pos) {
              location = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              };
            }
          }
        } catch (e) {
          console.warn("Location access denied or unavailable", e);
        }
      }

      const extractedTags = extractHashtags(finalContent);
      const allTags = mergeTagsWithHashtags(tags, extractedTags);

      if (isEditMode && onUpdate && editMemory) {
        // Update existing memory
        await onUpdate(editMemory.id, finalContent, attachments, allTags, editMemory.location);
      } else {
        // Create new memory
        await onCreate(finalContent, attachments, allTags, location);
      }
      handleCloseConfirmed();

    } catch (error) {
        console.error("Error saving memory:", error);
        setIsProcessing(false);
        alert(`Failed to ${isEditMode ? 'update' : 'save'} memory. Please try again.`);
    }
  };

  const handleCloseConfirmed = () => {
    setChecklistItems([]);
    setTags([]);
    setIsProcessing(false);
    setShowDiscardConfirm(false);
    onClose();
  };

  const handleClose = () => {
    // Check for unsaved changes in edit mode, or any content in create mode
    if (isEditMode ? hasChanges() : hasContent) {
      setShowDiscardConfirm(true);
      return;
    }
    handleCloseConfirmed();
  };

  // Intercept Android native back so it triggers discard confirmation, matching the on-screen back button
  useBackButton(handleClose, !showDiscardConfirm);

  // Keyboard shortcut: ⌘+Enter or Ctrl+Enter to save
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => { handleSubmitRef.current = handleSubmit; });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmitRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasContent = !isEmpty || attachments.length > 0 || (isChecklistMode && checklistItems.some(item => item.text.trim()));

  const discardTitle = isEditMode ? 'Discard Changes?' : 'Discard Memory?';
  const discardMessage = isEditMode
    ? 'You have unsaved changes. Are you sure you want to discard them?'
    : 'You have unsaved content. If you leave now, this memory will be lost.';

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-(--z-sheet)" dir="ltr">
        {/* Header */}
        <div className="shrink-0 bg-(--color-surface-base)/90 backdrop-blur-md border-b border-(--color-border-default) px-4 py-3 flex items-center justify-between pt-[calc(var(--sat)+12px)]">
            <div className="flex items-center gap-3">
                <button
                    onClick={handleClose}
                    className={overlay.closeBtn}
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-(--color-text-primary)">{isEditMode ? 'Edit Memory' : 'New Memory'}</h1>
            </div>
        </div>

        {/* Full-page editor area */}
        <main
            className="flex-1 overflow-y-auto p-4 sm:p-8 max-w-3xl mx-auto w-full"
            onClick={(e) => {
                // Focus the editor when tapping empty space in the main area
                if (!isChecklistMode && editorRef.current && !editorRef.current.contains(e.target as Node)) {
                    editorRef.current.focus();
                    // Place cursor at end of content
                    const selection = window.getSelection();
                    if (selection && editorRef.current.childNodes.length > 0) {
                        selection.selectAllChildren(editorRef.current);
                        selection.collapseToEnd();
                    }
                }
            }}
        >
            <div className="min-h-full relative text-left flex flex-col" dir="ltr">
                {isChecklistMode ? (
                    <ChecklistEditor
                        items={checklistItems}
                        onToggle={toggleChecklistItemChecked}
                        onUpdate={updateChecklistItem}
                        onAdd={addChecklistItem}
                        onRemove={removeChecklistItem}
                        onIndent={indentChecklistItem}
                        onOutdent={outdentChecklistItem}
                        onMove={moveChecklistItem}
                        autoFocusLast
                    />
                ) : (
                    <>
                        <div
                            ref={editorRef}
                            contentEditable
                            className="w-full flex-1 min-h-[200px] bg-transparent text-lg text-(--color-text-primary) focus:outline-none prose prose-invert max-w-none
                            rich-editor
                            text-left touch-manipulation"
                            dir="ltr"
                            onKeyDown={(e) => {
                                if (editorRef.current) {
                                    handleEditorKeyDown(e, editorRef.current, checkFormats);
                                }
                            }}
                            onKeyUp={checkFormats}
                            onMouseUp={checkFormats}
                            onInput={checkFormats}
                            onPaste={handlePaste}
                            suppressContentEditableWarning={true}
                        />
                        {isEmpty && (
                            <div className="absolute top-0 left-0 pointer-events-none text-(--color-text-tertiary) text-lg">
                                Capture a thought, idea, or observation...
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>

        {/* Sticky bottom card */}
        <div
          className={`shrink-0 px-3 pt-1 max-w-3xl mx-auto w-full${isNative() ? ' transition-[padding-bottom] duration-(--duration-keyboard) ease-(--ease-keyboard)' : ''}`}
          style={{ paddingBottom: 'max(var(--kb-inset, 0px), 0.75rem, var(--sab))' }}
        >
          <div className="bg-(--color-surface-overlay)/95 backdrop-blur-xl border border-(--color-border-default)/50 rounded-(--radius-xl) shadow-2xl shadow-black/40">
            {/* File too large warning */}
            {rejectedFiles.length > 0 && (
              <div className="px-4 pt-3 pb-1">
                <div className="flex items-start gap-2 text-xs text-(--color-danger) bg-(--color-danger)/10 border border-(--color-danger)/30 rounded-(--radius-md) px-3 py-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    {rejectedFiles.length === 1
                      ? `"${rejectedFiles[0].name}" exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`
                      : `${rejectedFiles.length} files exceed the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`}
                  </span>
                </div>
              </div>
            )}

            {/* Attachment limit warning */}
            {droppedForLimit > 0 && (
              <div className="px-4 pt-3 pb-1">
                <div className="flex items-start gap-2 text-xs text-(--color-danger) bg-(--color-danger)/10 border border-(--color-danger)/30 rounded-(--radius-md) px-3 py-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    {droppedForLimit === 1
                      ? `1 file not added — maximum ${MAX_ATTACHMENTS} attachments per note`
                      : `${droppedForLimit} files not added — maximum ${MAX_ATTACHMENTS} attachments per note`}
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
                                    <div className="w-14 h-14 rounded-(--radius-xl) overflow-hidden border border-(--color-border-default) bg-black/50">
                                        <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="w-14 h-14 rounded-(--radius-xl) border border-(--color-border-default) bg-(--color-surface-raised)/50 flex flex-col items-center justify-center">
                                        <FileText size={18} className="text-(--color-text-secondary)" />
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

            {/* Tag section (expandable) */}
            {showTags && (
                <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-(--duration-fast)">
                    <TagInput tags={tags} onTagsChange={setTags} compact />
                </div>
            )}

            {/* Formatting toolbar (expandable) */}
            {showFormatting && !isChecklistMode && (
                <div className="px-4 pt-3 pb-1 animate-in slide-in-from-bottom-2 duration-(--duration-fast)">
                    <FormattingToolbar activeFormats={activeFormats} onFormat={handleFormat} compact />
                </div>
            )}

            {/* Button row */}
            <div className="flex items-center gap-1 px-3 py-2">
                {/* Attachment */}
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

                {/* Tags toggle */}
                <button
                    onClick={() => setShowTags(prev => !prev)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`${btn.iconLg} ${showTags ? 'bg-(--color-accent) text-(--color-text-primary)' : ''}`}
                    title="Tags"
                >
                    <Hash size={20} />
                </button>

                {/* Formatting toggle */}
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

                {/* Checklist toggle */}
                <button
                    onClick={toggleChecklistMode}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`${btn.iconLg} ${isChecklistMode ? 'bg-(--color-accent) text-(--color-text-primary)' : ''}`}
                    title="Checklist Mode"
                >
                    <CheckSquare size={20} />
                </button>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Save button */}
                <button
                    onClick={handleSubmit}
                    disabled={!hasContent || isProcessing}
                    className={`${btn.base} ${
                        hasContent && !isProcessing
                            ? `${btn.primary} shadow-lg`
                            : 'bg-(--color-surface-raised) text-(--color-text-tertiary) rounded-(--radius-lg) px-4 py-2.5 cursor-not-allowed'
                    } gap-2 px-5`}
                    title={isEditMode ? "Update (⌘+Enter)" : "Add (⌘+Enter)"}
                >
                    {isProcessing ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-sm">{isEditMode ? 'Updating...' : 'Adding...'}</span>
                      </>
                    ) : (
                      <>
                        {isEditMode ? <Send size={18} /> : <Plus size={18} strokeWidth={3} />}
                        <span className="text-sm">{isEditMode ? 'Update' : 'Add'}</span>
                      </>
                    )}
                </button>
            </div>
          </div>
        </div>

        {/* Discard Changes Confirmation Dialog */}
        {showDiscardConfirm && (
            <div className={`${overlay.dialogBackdrop} bg-(--color-surface-overlay)/90 backdrop-blur-md animate-in fade-in duration-(--duration-fast)`}>
                <div className={`${overlay.modal} p-6 max-w-sm w-full mx-4 animate-in zoom-in-95 duration-(--duration-fast)`}>
                    <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 bg-(--color-warning)/30 rounded-(--radius-full) flex items-center justify-center mb-4">
                            <AlertTriangle size={32} className="text-(--color-warning)" />
                        </div>
                        <h3 className="text-xl font-bold text-(--color-text-primary) mb-2">{discardTitle}</h3>
                        <p className="text-base text-(--color-text-secondary) mb-6">
                            {discardMessage}
                        </p>
                        <div className="flex gap-4 w-full">
                            <button
                                onClick={() => setShowDiscardConfirm(false)}
                                className={`${btn.base} ${btn.secondary} flex-1 py-3`}
                            >
                                Keep Editing
                            </button>
                            <button
                                onClick={handleCloseConfirmed}
                                className={`${btn.base} ${btn.danger} flex-1 py-3 shadow-lg`}
                            >
                                Discard
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default NewMemoryPage;
