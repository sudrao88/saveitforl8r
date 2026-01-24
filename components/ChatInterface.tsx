import React, { useState, useEffect, useRef } from 'react';
import { X, Send, BrainCircuit, ExternalLink, Bot, Sparkles } from 'lucide-react';
import { Memory } from '../types';
import { queryBrain } from '../services/geminiService';
import MemoryCard from './MemoryCard';

interface ChatInterfaceProps {
  memories: Memory[];
  onClose: () => void;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  sources?: string[]; // IDs of memories used
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ memories, onClose }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState({ height: '100dvh', top: 0 });

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    // Lock body scroll
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    // Visual Viewport logic for mobile keyboards
    const handleResize = () => {
        if (window.visualViewport) {
            setViewport({
                height: `${window.visualViewport.height}px`,
                top: window.visualViewport.offsetTop
            });
            setTimeout(scrollToBottom, 100);
        }
    };

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        window.visualViewport.addEventListener('scroll', handleResize);
        handleResize();
    }

    setTimeout(scrollToBottom, 100);

    return () => {
      document.body.style.overflow = originalStyle;
      if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleResize);
          window.visualViewport.removeEventListener('scroll', handleResize);
      }
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

  const handleSend = async () => {
    if (!query.trim() || loading) return;

    const userMsg: Message = { role: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setLoading(true);
    
    // Reset textarea height
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
    }

    try {
      const { answer, sourceIds } = await queryBrain(userMsg.text, memories);
      setMessages(prev => [...prev, { role: 'model', text: answer, sources: sourceIds }]);
    } catch (error) {
      console.error('Search error:', error);
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error searching your memories." }]);
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
    <div className="fixed inset-0 z-[60] bg-gray-900" aria-hidden="true" style={{ height: '100vh', touchAction: 'none' }} />
    
    <div 
        className="fixed left-0 right-0 z-[61] flex flex-col overflow-hidden bg-gray-900"
        style={{ height: viewport.height, top: viewport.top }}
    >
      {/* Header */}
      <div className="flex-none border-b border-gray-800 px-4 py-3 flex items-center justify-between bg-gray-900 z-10 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
            <BrainCircuit size={24} className="text-blue-500" />
            <h2 className="text-lg font-bold text-gray-100">Brain Search</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full transition text-gray-400">
          <X size={24} />
        </button>
      </div>

      {/* Messages Area */}
      <div 
        ref={messagesEndRef} 
        className="flex-1 overflow-y-auto p-4 md:px-20 lg:px-64 space-y-6 bg-gray-900 overscroll-contain"
        style={{ overscrollBehaviorY: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-50 px-4 pt-10">
            <BrainCircuit size={48} className="text-blue-500 mb-6" />
            <h3 className="text-xl font-bold text-gray-100 mb-2">Neural Retrieval</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Ask questions to your second brain. SaveItForL8R synthesizes answers using only your captured memories.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in`}>
            <div className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-5 py-3 ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-gray-800 border border-gray-700 text-gray-100 shadow-sm'
            }`}>
              <div className="whitespace-pre-wrap leading-relaxed font-medium text-sm md:text-base break-words">
                  {msg.text}
              </div>
              
              {/* Citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-700/50">
                    <p className="text-[10px] font-black uppercase text-gray-500 mb-2 tracking-widest">Sources</p>
                    <div className="grid grid-cols-1 gap-2">
                        {msg.sources.map(id => {
                            const mem = memories.find(m => m.id === id);
                            if (!mem) return null;
                            return (
                                <button 
                                    key={id}
                                    onClick={() => setPreviewMemoryId(id)}
                                    className="flex items-center gap-2 p-1.5 bg-gray-900 rounded-lg border border-gray-700 hover:border-blue-500 transition-all text-left shadow-sm group"
                                >
                                    {mem.image && (
                                        <img src={mem.image} className="w-8 h-8 rounded-md object-cover bg-gray-800 border border-gray-800" alt="" />
                                    )}
                                    <div className="flex-1 overflow-hidden min-w-0">
                                        <p className="text-[10px] font-bold text-gray-200 truncate">
                                            {mem.enrichment?.summary || mem.content || "Memory Entry"}
                                        </p>
                                        <p className="text-[9px] text-gray-500">{new Date(mem.timestamp).toLocaleDateString()}</p>
                                    </div>
                                    <ExternalLink size={12} className="text-gray-600 group-hover:text-blue-400 shrink-0 mx-1" />
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
          <div className="flex gap-3 items-center text-blue-500 font-bold animate-pulse px-4">
            <Sparkles size={16} className="animate-spin" />
            <span className="text-sm">Synthesizing...</span>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div 
        className="flex-none w-full bg-gray-900 border-t border-gray-800 shrink-0 z-20"
        style={{ 
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingTop: '1rem',
            paddingLeft: '1rem',
            paddingRight: '1rem'
        }}
      >
        <div className="max-w-4xl mx-auto flex items-end gap-3 bg-gray-800 px-4 py-2 rounded-2xl border border-gray-700 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all shadow-sm">
            <textarea
                ref={textareaRef}
                autoFocus
                rows={1}
                className="w-full text-base font-medium focus:outline-none bg-transparent placeholder-gray-500 border-none text-gray-100 py-2 resize-none max-h-32"
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
                className="mb-1 p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
                <Send size={18} />
            </button>
        </div>
      </div>

      {/* Memory Preview Modal */}
      {previewMemory && (
          <div 
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            onClick={() => setPreviewMemoryId(null)}
          >
              <div className="relative w-full max-w-lg animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                  <MemoryCard memory={previewMemory} isDialog={true} />
                  <button 
                    onClick={() => setPreviewMemoryId(null)}
                    className="mt-4 w-full py-3 bg-gray-800 text-white rounded-xl font-bold shadow-xl border border-gray-700 text-sm"
                  >
                      Close Preview
                  </button>
              </div>
          </div>
      )}
    </div>
    </>
  );
};

export default ChatInterface;
