import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, X, Clock, WifiOff, Loader2 } from 'lucide-react';
import { Memory, Attachment, CalendarEvent, TodoItem } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import { btn, input, overlay, text } from '../styles/design-system';
import { useBackButton } from '../hooks/useBackButton';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useDeferredAutoFocus } from '../hooks/useDeferredAutoFocus';
import { useNoteSearch } from '../hooks/useNoteSearch';
import { noteTitle, formatNoteDate } from '../utils/noteLabels';
import { excerptAround, wordMatchesTerms } from '../utils/noteSearch';
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch } from '../utils/recentSearches';

interface SearchPageProps {
  memories: Memory[];
  onClose: () => void;
  onViewAttachment: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onUpdate?: (id: string, content: string) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  calendarEvents?: CalendarEvent[];
  todoItems?: TodoItem[];
}

/** Render text with the words that match the query emphasized. */
const Highlighted: React.FC<{ value: string; terms: string[] }> = ({ value, terms }) => {
  if (terms.length === 0) return <>{value}</>;
  // Split on word boundaries but keep the separators so the text is unchanged.
  const parts = value.split(/([^\p{L}\p{N}]+)/u);
  return (
    <>
      {parts.map((part, i) =>
        part && wordMatchesTerms(part, terms) ? (
          <mark key={i} className="bg-transparent text-(--color-accent-hover) font-semibold">{part}</mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
};

/** The most relevant secondary line for a result: summary, or the matching part of the content. */
const resultSnippet = (m: Memory, title: string, terms: string[]): string => {
  const summary = m.enrichment?.summary || '';
  const content = m.content || '';
  const contentExcerpt = excerptAround(content, terms);
  const summaryMatches = summary && summary !== title && summary.split(/\s+/).some(w => wordMatchesTerms(w, terms));
  const contentMatches = contentExcerpt && contentExcerpt !== title && contentExcerpt.split(/\s+/).some(w => wordMatchesTerms(w, terms));
  if (contentMatches && !summaryMatches) return contentExcerpt;
  if (summary && summary !== title) return summary;
  return contentExcerpt !== title ? contentExcerpt : '';
};

const SearchPage: React.FC<SearchPageProps> = ({
  memories, onClose, onViewAttachment, onDelete, onEdit, onUpdate, onTogglePin, calendarEvents, todoItems,
}) => {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useKeyboardHeight();
  useDeferredAutoFocus(inputRef);

  // The page scrolls internally; keep the feed behind it still.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
    };
  }, []);

  const { results, terms, semanticStatus } = useNoteSearch(memories, query);
  const byId = useMemo(() => new Map(memories.map(m => [m.id, m])), [memories]);
  const hasQuery = query.trim().length > 0;

  const rememberQuery = useCallback(() => {
    const q = query.trim();
    if (q) setRecent(addRecentSearch(q));
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      rememberQuery();
      inputRef.current?.blur(); // dismiss the soft keyboard to reveal results
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else onClose();
    }
  };

  const openResult = (id: string) => {
    rememberQuery();
    setPreviewMemoryId(id);
  };

  const previewMemory = previewMemoryId ? byId.get(previewMemoryId) : undefined;

  const statusLine = (() => {
    if (!hasQuery) return null;
    if (semanticStatus === 'offline') {
      return <span className="flex items-center gap-1.5"><WifiOff size={12} /> Offline: showing keyword matches only</span>;
    }
    if (semanticStatus === 'error') return <span>Showing keyword matches only</span>;
    if (semanticStatus === 'pending') {
      return <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Finding related notes…</span>;
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-(--z-modal) flex flex-col overflow-hidden bg-(--color-surface-base)">
      {/* Header with search box */}
      <div className="flex-none border-b border-(--color-border-default) px-4 pb-3 pt-[calc(0.75rem+var(--sat))] flex items-center gap-2 bg-(--color-surface-base) z-(--z-sticky)">
        <button onClick={onClose} className={overlay.closeBtn} aria-label="Close search">
          <ArrowLeft size={22} />
        </button>
        <div className="relative flex-1 max-w-4xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={`${input.base} pl-9 pr-10 text-base [&::-webkit-search-cancel-button]:hidden`}
            placeholder="Search your notes"
            aria-label="Search your notes"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {hasQuery && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className={`${btn.base} ${btn.icon} absolute right-1 top-1/2 -translate-y-1/2`}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-2 md:px-20 lg:px-64 pt-2"
        style={{ paddingBottom: 'max(calc(var(--kb-inset, 0px) + 1rem), var(--sab))' }}
      >
        {!hasQuery ? (
          recent.length > 0 ? (
            <section aria-label="Recent searches">
              <div className="flex items-center justify-between px-3 py-2">
                <h3 className={text.label}>Recent</h3>
                <button
                  onClick={() => { clearRecentSearches(); setRecent([]); }}
                  className={`${btn.base} ${btn.ghost} text-xs`}
                >
                  Clear
                </button>
              </div>
              <ul>
                {recent.map(q => (
                  <li key={q} className="flex items-center">
                    <button onClick={() => setQuery(q)} className={`${btn.base} ${btn.listRow} flex-1 min-w-0`}>
                      <Clock size={16} className="text-(--color-text-tertiary) shrink-0" />
                      <span className="truncate text-sm text-(--color-text-secondary)">{q}</span>
                    </button>
                    <button
                      onClick={() => setRecent(removeRecentSearch(q))}
                      className={`${btn.base} ${btn.icon} shrink-0`}
                      aria-label={`Remove "${q}" from recent searches`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <div className="flex flex-col items-center text-center max-w-sm mx-auto px-4 pt-16">
              <Search size={40} className="text-(--color-text-tertiary) mb-4" />
              <p className={text.body}>Search by words or by meaning. Try a place, a person, or what a note was about.</p>
            </div>
          )
        ) : (
          <>
            {statusLine && <p className={`${text.caption} px-3 py-1`}>{statusLine}</p>}
            {results.length === 0 ? (
              semanticStatus !== 'pending' && (
                <p className={`${text.body} text-center pt-16 px-4`}>No notes match “{query.trim()}”.</p>
              )
            ) : (
              <>
                <p className={`${text.caption} px-3 py-1`}>
                  {results.length} {results.length === 1 ? 'note' : 'notes'}
                </p>
                <ul>
                  {results.map(r => {
                    const m = byId.get(r.id);
                    if (!m) return null;
                    const title = noteTitle(m);
                    const snippet = resultSnippet(m, title, terms);
                    const type = m.enrichment?.entityContext?.type;
                    return (
                      <li key={r.id}>
                        <button onClick={() => openResult(r.id)} className={`${btn.base} ${btn.listRow} items-start`}>
                          {m.image ? (
                            <img src={m.image} alt="" className="w-10 h-10 shrink-0 rounded-(--radius-md) object-cover bg-(--color-surface-raised)" />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-(--color-text-primary) line-clamp-1">
                              <Highlighted value={title} terms={terms} />
                            </p>
                            {snippet && (
                              <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-2">
                                <Highlighted value={snippet} terms={terms} />
                              </p>
                            )}
                            <p className={`${text.caption} mt-1`}>
                              {type && type !== 'Other' ? `${type} · ` : ''}{formatNoteDate(m.timestamp)}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {previewMemory && (
        <MemoryPreviewModal
          memory={previewMemory}
          onClose={() => setPreviewMemoryId(null)}
          onViewAttachment={onViewAttachment}
          onDelete={onDelete}
          onEdit={onEdit}
          onUpdate={onUpdate}
          onTogglePin={onTogglePin}
          calendarEvents={calendarEvents}
          todoItems={todoItems}
        />
      )}
    </div>
  );
};

export default SearchPage;
