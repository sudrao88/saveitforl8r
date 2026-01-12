
import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, RefreshCcw, Search, X, Clock, Eye } from 'lucide-react';
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;
    const userMsg: ChatMessage = { role: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setIsLoading(true);
    const { answer, sourceIds } = await queryBrain(userMsg.text, memories);
    setMessages(prev => [...prev, { role: 'model', text: answer, sources: sourceIds }]);
    setIsLoading(false);
  };

  const selectedMemory = memories.find(m => m.id === selectedMemoryId);

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900 flex flex-col animate-in slide-in-from-bottom duration-300">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between bg-gray-900/95 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4 flex-1 max-w-2xl bg-gray-800 px-4 py-2 rounded-2xl border border-gray-700">
          <Search size={20} className="text-blue-500 shrink-0" />
          <input
            autoFocus
            type="text"
            className="w-full text-lg font-medium focus:outline-none bg-transparent placeholder-gray-500 border-none text-gray-100"
            placeholder="Search your brain..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
        </div>
        <button onClick={onClose} className="ml-4 p-2 hover:bg-gray-800 rounded-full transition text-gray-400"><X size={24} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:px-20 lg:px-64 space-y-10">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-50">
            <Bot size={48} className="text-blue-500 mb-6" />
            <h3 className="text-xl font-bold text-gray-100 mb-2">Neural Retrieval</h3>
            <p className="text-sm text-gray-400 leading-relaxed">SaveItForL8r synthesizes answers using only your captured memories.</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in`}>
            <div className={`max-w-[90%] sm:max-w-[80%] rounded-3xl px-6 py-4 ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-xl' : 'bg-gray-800 border border-gray-700 text-gray-100 shadow-sm'}`}>
              <div className="whitespace-pre-wrap leading-relaxed font-medium">{msg.text}</div>
              
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-700/50">
                  <p className="text-[10px] font-black uppercase text-gray-500 mb-3 tracking-widest">Knowledge Sources</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {msg.sources.map(id => {
                      const m = memories.find(mem => mem.id === id);
                      if (!m) return null;
                      return (
                        <button 
                          key={id}
                          onClick={() => setSelectedMemoryId(id)}
                          className="flex items-center gap-3 p-2 bg-gray-900 rounded-xl border border-gray-700 hover:border-blue-500 transition-all text-left shadow-sm group"
                        >
                          {m.image && (
                            <img src={m.image} className="w-12 h-12 rounded-lg object-cover bg-gray-800 border border-gray-800" />
                          )}
                          <div className="flex-1 overflow-hidden">
                            <p className="text-[10px] font-bold text-gray-200 truncate">
                              {m.enrichment?.summary || m.content || 'Memory Entry'}
                            </p>
                            <p className="text-[9px] text-gray-500 mt-0.5">{new Date(m.timestamp).toLocaleDateString()}</p>
                          </div>
                          <Eye size={14} className="text-gray-600 group-hover:text-blue-400 shrink-0 mr-1" />
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
          <div className="flex gap-4 items-center text-blue-500 font-bold animate-pulse">
            <RefreshCcw size={20} className="animate-spin" />
            <span className="text-sm">Synthesizing...</span>
          </div>
        )}
      </div>

      {selectedMemory && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => setSelectedMemoryId(null)}>
          <div className="relative w-full max-w-lg animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <MemoryCard memory={selectedMemory} isDialog />
            <button onClick={() => setSelectedMemoryId(null)} className="mt-6 w-full py-4 bg-gray-800 text-white rounded-2xl font-bold shadow-xl border border-gray-700">Close Preview</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
