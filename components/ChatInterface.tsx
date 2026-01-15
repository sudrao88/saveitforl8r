
import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, RefreshCcw, X, Eye } from 'lucide-react';
import { Memory, ChatMessage } from '../types.ts';
import { queryBrain } from '../services/geminiService.ts';
import MemoryCard from './MemoryCard.tsx';

interface ChatInterfaceProps {
  memories: Memory[];
  onClose: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ memories, onClose }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Viewport management for iOS keyboard handling
  const [viewportStyle, setViewportStyle] = useState<{ height: string; top: number }>({
    height: '100dvh', // Default to dynamic viewport height
    top: 0
  });

  useEffect(() => {
    // Lock body scroll to prevent background interaction
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    const handleVisualViewport = () => {
      // If visualViewport API is supported (modern mobile browsers)
      if (window.visualViewport) {
        setViewportStyle({
          height: `${window.visualViewport.height}px`,
          top: window.visualViewport.offsetTop
        });
        
        // Ensure scrolling to bottom if needed when viewport resizes (e.g., keyboard opens)
        if (scrollRef.current) {
          // Small delay to ensure layout is done
          setTimeout(() => {
              if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
          }, 100);
        }
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewport);
      window.visualViewport.addEventListener('scroll', handleVisualViewport);
      // Initial set
      handleVisualViewport();
    }

    return () => {
      document.body.style.overflow = originalStyle;
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewport);
        window.visualViewport.removeEventListener('scroll', handleVisualViewport);
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;
    const userMsg: ChatMessage = { role: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setIsLoading(true);
    
    try {
      const { answer, sourceIds } = await queryBrain(userMsg.text, memories);
      setMessages(prev => [...prev, { role: 'model', text: answer, sources: sourceIds }]);
    } catch (error) {
      console.error('Search error:', error);
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error searching your memories." }]);
    } finally {
      setIsLoading(false);
      // Refocus input after sending to keep keyboard up for chat flow
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const selectedMemory = memories.find(m => m.id === selectedMemoryId);

  return (
    <>
      {/* 
        Full page cover layer (Backdrop). 
        Stays fixed and full height to cover memory cards even when keyboard is up.
      */}
      <div className="fixed inset-0 z-[60] bg-gray-900" aria-hidden="true" />

      {/* 
        Chat Interface Container.
        Resizes and moves based on visualViewport to handle virtual keyboard.
        Sits on top of the backdrop.
      */}
      <div 
        className="fixed left-0 right-0 z-[61] flex flex-col overflow-hidden"
        style={{ 
          height: viewportStyle.height, 
          top: viewportStyle.top,
        }}
      >
        {/* Header */}
        <div className="flex-none border-b border-gray-800 px-6 py-4 flex items-center justify-between bg-gray-900 z-10">
            <div className="flex items-center gap-2">
               <Bot size={24} className="text-blue-500" />
               <h2 className="text-lg font-bold text-gray-100">Brain Search</h2>
            </div>
          <button onClick={onClose} className="ml-4 p-2 hover:bg-gray-800 rounded-full transition text-gray-400"><X size={24} /></button>
        </div>

        {/* Messages Area - Flex 1 to take available space */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:px-20 lg:px-64 space-y-6 bg-gray-900 overscroll-contain">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-50 px-4">
              <Bot size={48} className="text-blue-500 mb-6" />
              <h3 className="text-xl font-bold text-gray-100 mb-2">Neural Retrieval</h3>
              <p className="text-sm text-gray-400 leading-relaxed">Ask questions to your second brain. SaveItForL8r synthesizes answers using only your captured memories.</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in`}>
              <div className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-5 py-3 ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-800 border border-gray-700 text-gray-100 shadow-sm'}`}>
                <div className="whitespace-pre-wrap leading-relaxed font-medium text-sm md:text-base">{msg.text}</div>
                
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-700/50">
                    <p className="text-[10px] font-black uppercase text-gray-500 mb-2 tracking-widest">Sources</p>
                    <div className="grid grid-cols-1 gap-2">
                      {msg.sources.map(id => {
                        const m = memories.find(mem => mem.id === id);
                        if (!m) return null;
                        return (
                          <button 
                            key={id}
                            onClick={() => setSelectedMemoryId(id)}
                            className="flex items-center gap-2 p-1.5 bg-gray-900 rounded-lg border border-gray-700 hover:border-blue-500 transition-all text-left shadow-sm group"
                          >
                            {m.image && (
                              <img src={m.image} className="w-8 h-8 rounded-md object-cover bg-gray-800 border border-gray-800" alt="" />
                            )}
                            <div className="flex-1 overflow-hidden min-w-0">
                              <p className="text-[10px] font-bold text-gray-200 truncate">
                                {m.enrichment?.summary || m.content || 'Memory Entry'}
                              </p>
                              <p className="text-[9px] text-gray-500">{new Date(m.timestamp).toLocaleDateString()}</p>
                            </div>
                            <Eye size={12} className="text-gray-600 group-hover:text-blue-400 shrink-0 mx-1" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 items-center text-blue-500 font-bold animate-pulse px-4">
              <RefreshCcw size={16} className="animate-spin" />
              <span className="text-sm">Synthesizing...</span>
            </div>
          )}
        </div>

         {/* Input Area - Flex None to stay at bottom */}
         <div className="flex-none bg-gray-900 border-t border-gray-800 p-3 safe-area-bottom z-30">
          <div className="max-w-4xl mx-auto flex items-center gap-3 bg-gray-800 px-4 py-2 rounded-2xl border border-gray-700 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              className="w-full text-base font-medium focus:outline-none bg-transparent placeholder-gray-500 border-none text-gray-100 py-1"
              placeholder="Ask your second brain..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
             <button 
              onClick={handleSend}
              disabled={!query.trim() || isLoading}
              className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      {selectedMemory && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => setSelectedMemoryId(null)}>
          <div className="relative w-full max-w-lg animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <MemoryCard memory={selectedMemory} isDialog />
            <button onClick={() => setSelectedMemoryId(null)} className="mt-4 w-full py-3 bg-gray-800 text-white rounded-xl font-bold shadow-xl border border-gray-700 text-sm">Close Preview</button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatInterface;
