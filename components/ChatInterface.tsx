import React, { useState, useEffect, useRef } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import { X, Send, BrainCircuit, ExternalLink, Bot, Sparkles, WifiOff, Download, FileText } from 'lucide-react';
import { Memory, Attachment, ChatMessage } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import { btn, overlay } from '../styles/design-system';
import { isNative } from '../services/platform';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useDeferredAutoFocus } from '../hooks/useDeferredAutoFocus';

interface ChatInterfaceProps {
  memories: Memory[];
  onClose: () => void;
  searchFunction: (query: string, memories: Memory[], history?: ChatMessage[]) => Promise<{ mode: string; result: any; error?: any }>;
  onViewAttachment: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

interface Source {
  id: string;
  preview: string;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: Source[]; // Structured sources
  isOffline?: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ memories, onClose, searchFunction, onViewAttachment, onDelete, onEdit, onTogglePin }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);

  // Dismiss preview modal on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState({ height: '100dvh', top: 0 });

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
    }
  };

  const keyboardHeight = useKeyboardHeight({
    onShow: () => setTimeout(scrollToBottom, 100),
  });

  useDeferredAutoFocus(textareaRef);

  useEffect(() => {
    // Lock body scroll
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    if (!isNative() && window.visualViewport) {
      const handleResize = () => {
        setViewport({
          height: `${window.visualViewport!.height}px`,
          top: window.visualViewport!.offsetTop
        });
        setTimeout(scrollToBottom, 100);
      };
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
      handleResize();

      return () => {
        document.body.style.overflow = originalStyle;
        window.visualViewport?.removeEventListener('resize', handleResize);
        window.visualViewport?.removeEventListener('scroll', handleResize);
      };
    }

    setTimeout(scrollToBottom, 100);

    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
      if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
  }, [query]);

  const MAX_HISTORY_TURNS = 10;
  const MAX_TURN_TEXT_LENGTH = 4000;

  const handleSend = async () => {
    if (!query.trim() || loading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text: query };

    // Build conversation history from current messages (before adding the new user message).
    // Strip sources and isOffline — server only needs role + text.
    // Cap to most recent MAX_HISTORY_TURNS messages, truncate text to match server limit.
    const history: ChatMessage[] = messages
      .slice(-MAX_HISTORY_TURNS)
      .map(m => ({ role: m.role, text: m.text.substring(0, MAX_TURN_TEXT_LENGTH) }));

    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
    }

    try {
      const response = await searchFunction(userMsg.text, memories, history);
      
      if (response.mode === 'online') {
          const { answer, sources } = response.result;
          setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: answer, sources: sources }]);
      } else if (response.mode === 'offline') {
          const items = response.result;
          const text = items.length > 0
              ? "I found these relevant notes in your offline database:"
              : "I couldn't find any relevant notes in your offline database.";

          const uniqueSourceIds = Array.from(new Set(items.map((item: any) =>
            item.metadata?.originalId || item.id
          ))) as string[];

          const sources: Source[] = uniqueSourceIds.map(id => ({
            id,
            preview: memories.find(m => m.id === id)?.content?.substring(0, 100) || ""
          }));

          setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'model',
              text,
              sources,
              isOffline: true
          }]);
      } else if (response.mode === 'offline_model_error') {
          // Model failed to load - likely offline without cached model
          const errorText = response.error || 'The search model is not available.';
          setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'model',
              text: `⚠️ ${errorText}\n\nTo use offline search, please connect to the internet once to download the search model. It will then be cached for future offline use.`,
              isOffline: true
          }]);
      } else {
           setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: "Sorry, I encountered an error searching your memories." }]);
      }

    } catch (error) {
      console.error('Search error:', error);
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: "Sorry, I encountered an error searching your memories." }]);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const previewMemory = memories.find(m => m.id === previewMemoryId);

  return (
    <>
    <div className="fixed inset-0 z-(--z-modal) bg-black" aria-hidden="true" style={{ height: '100vh', touchAction: 'none' }} />

    <div
        className="fixed left-0 right-0 z-(--z-modal) flex flex-col overflow-hidden bg-black"
        style={{
          height: keyboardHeight > 0 ? `calc(100dvh - ${keyboardHeight}px)` : viewport.height,
          top: viewport.top,
          transition: 'height var(--duration-keyboard) var(--ease-keyboard)',
        }}
    >
      {/* Header */}
      <div className="flex-none border-b border-(--color-border-default) px-4 pb-3 pt-[calc(0.75rem+var(--sat))] flex items-center justify-between bg-black z-(--z-sticky) shadow-sm shrink-0">
        <div className="flex items-center gap-2">
            <BrainCircuit size={24} className="text-(--color-accent)" />
            <h2 className="text-lg font-bold text-(--color-text-primary)">Brain Search</h2>
        </div>
        <button onClick={onClose} className={overlay.closeBtn}>
          <X size={24} />
        </button>
      </div>

      {/* Messages Area */}
      <div 
        ref={messagesEndRef} 
        className="flex-1 overflow-y-auto p-4 md:px-20 lg:px-64 space-y-6 bg-black overscroll-contain"
        style={{ overscrollBehaviorY: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-50 px-4 pt-10">
            <BrainCircuit size={48} className="text-(--color-accent) mb-6" />
            <h3 className="text-xl font-bold text-(--color-text-primary) mb-2">Neural Retrieval</h3>
            <p className="text-sm text-(--color-text-secondary) leading-relaxed">
              Ask questions to your second brain. SaveItForL8R synthesizes answers using only your captured memories.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in`}>
            <div className={`max-w-[90%] sm:max-w-[80%] rounded-(--radius-xl) px-5 py-3 ${
              msg.role === 'user' 
                ? 'bg-(--color-accent) text-(--color-text-primary) shadow-md' 
                : 'bg-(--color-surface-raised) border border-(--color-border-default) text-(--color-text-primary) shadow-sm'
            }`}>
              {msg.isOffline && (
                <div className="flex items-center mb-1">
                   <span className="flex items-center gap-1 text-xs uppercase font-bold text-(--color-warning)/80 mb-1">
                      <WifiOff size={10} /> Offline Mode
                   </span>
                </div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed font-medium text-sm md:text-base break-words">
                  {msg.text}
              </div>
              
              {/* Citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-(--color-border-subtle)">
                    <p className="text-xs font-black uppercase text-(--color-text-tertiary) mb-2 tracking-widest">
                        {msg.isOffline ? 'Relevant Notes' : 'Sources'}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                        {msg.sources.map(source => {
                            const mem = memories.find(m => m.id === source.id);
                            if (!mem) return null;
                            return (
                                <button 
                                    key={source.id}
                                    onClick={() => setPreviewMemoryId(source.id)}
                                    className="flex items-center gap-2 p-1.5 bg-(--color-surface-overlay) rounded-(--radius-lg) border border-(--color-border-default) hover:border-(--color-accent) transition-all text-left shadow-sm group active:scale-[0.98]"
                                >
                                    {mem.image && (
                                        <img src={mem.image} className="w-8 h-8 rounded-(--radius-md) object-cover bg-(--color-surface-raised) border border-(--color-border-default)" alt="" />
                                    )}
                                    <div className="flex-1 overflow-hidden min-w-0">
                                        <p className="text-xs font-bold text-(--color-text-primary) truncate">
                                            {source.preview || mem.enrichment?.summary || mem.content || "Memory Entry"}
                                        </p>
                                        <p className="text-xs text-(--color-text-tertiary)">{(() => { const d = new Date(mem.timestamp); return isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(); })()}</p>
                                    </div>
                                    <ExternalLink size={12} className="text-(--color-text-tertiary) group-hover:text-(--color-accent) shrink-0 mx-1" />
                                </button>
                            );
                        })}
                    </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start animate-in fade-in">
            <div className="bg-(--color-surface-raised) border border-(--color-border-default) rounded-(--radius-xl) px-5 py-4 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-(--color-accent) typing-dot" />
              <span className="w-2 h-2 rounded-full bg-(--color-accent) typing-dot" style={{ animationDelay: '0.15s' }} />
              <span className="w-2 h-2 rounded-full bg-(--color-accent) typing-dot" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div
        className="flex-none w-full bg-black shrink-0 z-(--z-dropdown)"
        style={{
            paddingBottom: keyboardHeight > 0 ? '0.5rem' : 'max(1rem, var(--sab))',
            paddingTop: '1rem',
            paddingLeft: '1rem',
            paddingRight: '1rem',
            transition: 'padding-bottom var(--duration-keyboard) var(--ease-keyboard)',
        }}
      >
        <div className="max-w-4xl mx-auto flex items-end gap-3 bg-(--color-surface-raised) px-4 py-2 rounded-(--radius-xl) border border-(--color-border-default) focus-within:border-(--color-accent) focus-within:ring-1 focus-within:ring-(--color-accent) transition-all shadow-sm">
            <textarea
                ref={textareaRef}
                rows={1}
                className="w-full text-base font-medium focus:outline-none bg-transparent placeholder-(--color-text-tertiary) border-none text-(--color-text-primary) py-2 resize-none max-h-32"
                placeholder="Ask your second brain..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    setTimeout(scrollToBottom, 300);
                }}
            />
            <button
                onClick={handleSend}
                disabled={!query.trim() || loading}
                className={`${btn.base} ${(!query.trim() || loading) ? btn.ctaDisabled : btn.cta} mb-1`}
            >
                <Send size={20} />
            </button>
        </div>
      </div>

      {/* Memory Preview Modal */}
      {previewMemory && (
          <MemoryPreviewModal
            memory={previewMemory}
            onClose={() => setPreviewMemoryId(null)}
            onViewAttachment={onViewAttachment}
            onDelete={onDelete}
            onEdit={onEdit}
            onTogglePin={onTogglePin}
          />
      )}
    </div>
    </>
  );
};

export default ChatInterface;