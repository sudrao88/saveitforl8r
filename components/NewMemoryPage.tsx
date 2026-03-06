import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Paperclip, FileText, X, Loader2, ArrowLeft, Bold, Italic, Underline, Heading1, Heading2, CheckSquare, Plus, AlertTriangle } from 'lucide-react';
import { marked } from 'marked';
import { Attachment, Memory } from '../types';
import { isNative } from '../services/platform';
import { Keyboard } from '@capacitor/keyboard';
import { escapeHtml, looksLikeMarkdown, sanitizePastedHtml, hasRichFormatting } from '../utils/editorUtils';
import { processFileInputs } from '../utils/attachmentUtils';
import { ToolbarButton } from './FormattingToolbar';
import TagInput, { SUGGESTED_TAGS } from './TagInput';

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

  // For Rich Text Mode
  const editorRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const pendingEditorContent = useRef<string | null>(null);

  // For Checklist Mode
  interface ChecklistItem {
    id: string;
    text: string;
    checked: boolean;
  }
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() => {
    const content = getInitialContent();
    if (content.startsWith('<ul class="checklist">')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      const items = Array.from(doc.querySelectorAll('li'));
      return items.map(item => ({
        id: crypto.randomUUID(),
        text: item.textContent || '',
        checked: item.getAttribute('data-checked') === 'true'
      }));
    }
    return [];
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Focus editor on mount
  useEffect(() => {
    if (!isChecklistMode && editorRef.current) {
        setTimeout(() => {
            editorRef.current?.focus();
        }, 100);
    }
  }, [isChecklistMode]);

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

    if (html && hasRichFormatting(html)) {
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

    setIsEmpty(!editorRef.current?.innerText.trim());
    checkFormats();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newAttachments = await processFileInputs(e.target.files);
      setAttachments(prev => [...prev, ...newAttachments]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };


  // Rich Text Formatting
  const execFormat = (command: string, value?: string) => {
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
  };

  const checkFormats = () => {
      const formats: string[] = [];
      if (document.queryCommandState('bold')) formats.push('bold');
      if (document.queryCommandState('italic')) formats.push('italic');
      if (document.queryCommandState('underline')) formats.push('underline');
      
      const block = document.queryCommandValue('formatBlock');
      if (block === 'h1') formats.push('H1');
      if (block === 'h2') formats.push('H2');
      
      setActiveFormats(formats);
      
      if (editorRef.current) {
          setIsEmpty(!editorRef.current.innerText.trim());
      }
  };

  const isFormatActive = (format: string) => activeFormats.includes(format);

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
      }
  };

  const updateChecklistItem = (id: string, text: string) => {
      setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  };

  const addChecklistItem = (afterId: string) => {
      setChecklistItems(prev => {
          const index = prev.findIndex(item => item.id === afterId);
          const newItem = { id: crypto.randomUUID(), text: '', checked: false };
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

  // Check if there are unsaved changes
  const hasChanges = useCallback((): boolean => {
    // Get current content
    let currentContent = '';
    if (isChecklistMode) {
      const listItems = checklistItems.map(item =>
        `<li data-checked="${item.checked}">${escapeHtml(item.text)}</li>`
      ).join('');
      currentContent = checklistItems.length > 0 ? `<ul class="checklist">${listItems}</ul>` : '';
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
        const listItems = checklistItems.map(item =>
            `<li data-checked="${item.checked}">${escapeHtml(item.text)}</li>`
        ).join('');
        finalContent = `<ul class="checklist">${listItems}</ul>`;
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
          if (navigator.geolocation) {
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
                      accuracy: pos.coords.accuracy
                  };
              }
          }
        } catch (e) {
          console.warn("Location access denied or unavailable", e);
        }
      }

      if (isEditMode && onUpdate && editMemory) {
        // Update existing memory
        await onUpdate(editMemory.id, finalContent, attachments, tags, editMemory.location);
      } else {
        // Create new memory
        await onCreate(finalContent, attachments, tags, location);
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
    // In edit mode, check for unsaved changes
    if (isEditMode && hasChanges()) {
      setShowDiscardConfirm(true);
      return;
    }
    handleCloseConfirmed();
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50" dir="ltr">
        {/* Header */}
        <div className="shrink-0 bg-black/90 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center justify-between pt-[calc(env(safe-area-inset-top)+12px)]">
            <div className="flex items-center gap-3">
                <button
                    onClick={handleClose}
                    className="p-3 -ml-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors active:bg-gray-700"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-gray-100">{isEditMode ? 'Edit Memory' : 'New Memory'}</h1>
            </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 max-w-3xl mx-auto w-full flex flex-col">

            {/* Editor Area */}
            <div className="min-h-[200px] flex-1 overflow-y-auto relative text-left order-1 mb-6" dir="ltr">
                {isChecklistMode ? (
                    <div className="space-y-3">
                        {checklistItems.map((item, index) => (
                            <div key={item.id} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-200">
                                <div
                                    className="shrink-0 text-gray-500 cursor-pointer p-1 -m-1"
                                    onClick={() => setChecklistItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i))}
                                >
                                    <div className={`w-6 h-6 border-2 rounded-lg flex items-center justify-center transition-colors ${item.checked ? 'border-blue-500 bg-blue-500/20' : 'border-gray-600'}`}>
                                        {item.checked && <div className="w-3 h-3 bg-blue-500 rounded-sm" />}
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    value={item.text}
                                    onChange={(e) => updateChecklistItem(item.id, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addChecklistItem(item.id);
                                        }
                                        if (e.key === 'Backspace' && item.text === '' && checklistItems.length > 1) {
                                            e.preventDefault();
                                            removeChecklistItem(item.id);
                                        }
                                    }}
                                    autoFocus={index === checklistItems.length - 1} 
                                    placeholder="List item..."
                                    className={`flex-1 bg-transparent text-lg text-white placeholder-gray-600 focus:outline-none border-b border-transparent focus:border-gray-700/50 pb-2 transition-all text-left ${item.checked ? 'line-through text-gray-500' : ''}`}
                                    dir="ltr"
                                />
                            </div>
                        ))}
                        <button 
                            onClick={() => addChecklistItem(checklistItems[checklistItems.length - 1]?.id)}
                            className="flex items-center gap-2 text-gray-500 hover:text-blue-400 mt-4 pl-1 transition-colors text-base font-medium py-2 active:text-blue-500"
                        >
                            <Plus size={20} /> Add Item
                        </button>
                    </div>
                ) : (
                    <>
                        <div
                            ref={editorRef}
                            contentEditable
                            className="w-full min-h-[200px] bg-transparent text-lg text-white focus:outline-none prose prose-invert max-w-none 
                            prose-p:my-2 prose-ul:my-2 prose-li:my-0
                            [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-white
                            [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-gray-100
                            text-left touch-manipulation"
                            dir="ltr"
                            onKeyUp={checkFormats}
                            onMouseUp={checkFormats}
                            onInput={() => setIsEmpty(!editorRef.current?.innerText.trim())}
                            onPaste={handlePaste}
                            suppressContentEditableWarning={true}
                        />
                        {isEmpty && (
                            <div className="absolute top-0 left-0 pointer-events-none text-gray-500 text-lg">
                                Capture a thought, idea, or observation...
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Attachments Preview - MOVED ABOVE TOOLBAR */}
            {attachments.length > 0 && (
                <div className="flex gap-4 flex-wrap order-2 mb-6">
                    {attachments.map((att) => (
                        <div key={att.id} className="relative group animate-in zoom-in-90 duration-200">
                            {att.type === 'image' ? (
                                <div className="w-24 h-24 rounded-2xl overflow-hidden border border-gray-700 bg-black/50 shadow-lg">
                                    <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-24 h-24 rounded-2xl border border-gray-700 bg-gray-800/50 flex flex-col items-center justify-center p-2 text-center shadow-lg">
                                    <FileText size={24} className="text-gray-400 mb-2" />
                                    <span className="text-[10px] text-gray-400 w-full truncate px-1">{att.name}</span>
                                </div>
                            )}
                            <button 
                                onClick={() => removeAttachment(att.id)}
                                className="absolute -top-3 -right-3 bg-gray-800 text-gray-400 hover:text-red-400 border border-gray-600 rounded-full p-2 shadow-lg transition-colors active:scale-95"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Toolbar Area - Inline, above tags */}
            <div className="order-3 mb-4 shrink-0">
                 <div className="flex flex-nowrap items-center gap-3 bg-gray-800/90 backdrop-blur-md p-2 rounded-2xl border border-gray-700/50 shadow-xl overflow-x-auto no-scrollbar">
                    {/* Attachments Button */}
                    <ToolbarButton onClick={() => fileInputRef.current?.click()} title="Add Attachment">
                        <Paperclip size={20} />
                    </ToolbarButton>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                        multiple
                        accept="image/*,.pdf,.txt,.md"
                    />

                    <div className="w-px h-6 bg-gray-700/50 mx-1 shrink-0"></div>

                    {/* Formatting Controls (Only in Normal Mode) */}
                    {!isChecklistMode && (
                        <>
                            <ToolbarButton onClick={() => execFormat('bold')} title="Bold" isActive={isFormatActive('bold')}>
                                <Bold size={20} />
                            </ToolbarButton>
                            <ToolbarButton onClick={() => execFormat('italic')} title="Italic" isActive={isFormatActive('italic')}>
                                <Italic size={20} />
                            </ToolbarButton>
                            <ToolbarButton onClick={() => execFormat('underline')} title="Underline" isActive={isFormatActive('underline')}>
                                <Underline size={20} />
                            </ToolbarButton>
                            <div className="w-px h-6 bg-gray-700/50 mx-1 shrink-0"></div>
                            <ToolbarButton onClick={() => execFormat('formatBlock', 'H1')} title="Heading 1" isActive={isFormatActive('H1')}>
                                <Heading1 size={20} />
                            </ToolbarButton>
                            <ToolbarButton onClick={() => execFormat('formatBlock', 'H2')} title="Heading 2" isActive={isFormatActive('H2')}>
                                <Heading2 size={20} />
                            </ToolbarButton>
                            <div className="w-px h-6 bg-gray-700/50 mx-1 shrink-0"></div>
                        </>
                    )}

                    {/* Checklist Toggle */}
                    <ToolbarButton onClick={toggleChecklistMode} title="Checklist Mode" isActive={isChecklistMode}>
                        <CheckSquare size={20} />
                    </ToolbarButton>
                 </div>
            </div>

            <div className="pt-4 order-4 pb-4">
               <hr className="border-gray-800 mb-6" />

               {/* Tags Interface */}
               <TagInput tags={tags} onTagsChange={setTags} />

               <hr className="border-gray-800 my-6" />

               {/* Save Button */}
               <div className="flex justify-end pt-2 pb-6">
                  <button
                      onClick={handleSubmit}
                      disabled={isProcessing}
                      className={`flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all shadow-lg w-full sm:w-auto text-lg
                          ${isProcessing
                              ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-900/20 active:scale-95'
                          }`}
                  >
                      {isProcessing ? <Loader2 size={24} className="animate-spin" /> : <Send size={24} />}
                      {isProcessing ? (isEditMode ? 'Updating...' : 'Saving...') : (isEditMode ? 'Update Memory' : 'Save Memory')}
                  </button>
               </div>
            </div>
        </main>


        {/* Discard Changes Confirmation Dialog */}
        {showDiscardConfirm && (
            <div className="fixed inset-0 z-[100] bg-gray-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 bg-amber-900/30 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={32} className="text-amber-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-100 mb-2">Discard Changes?</h3>
                        <p className="text-base text-gray-400 mb-6">
                            You have unsaved changes. Are you sure you want to discard them?
                        </p>
                        <div className="flex gap-4 w-full">
                            <button
                                onClick={() => setShowDiscardConfirm(false)}
                                className="flex-1 py-3 text-sm font-medium text-gray-300 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors active:scale-95"
                            >
                                Keep Editing
                            </button>
                            <button
                                onClick={handleCloseConfirmed}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 active:scale-95"
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
