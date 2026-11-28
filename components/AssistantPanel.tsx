import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, Square, SquarePen, WifiOff, X } from 'lucide-react';
import { Memory, Attachment, CalendarEvent, TodoItem } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import { btn, card, chip, input, overlay, text } from '../styles/design-system';
import { useAssistant } from '../hooks/useAssistant';
import { useBackButton } from '../hooks/useBackButton';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useDeferredAutoFocus } from '../hooks/useDeferredAutoFocus';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { AssistantMessage } from '../services/assistantStore';
import { MAX_QUESTION_LENGTH } from '../services/assistantService';
import { noteTitle, formatNoteDate } from '../utils/noteLabels';

interface AssistantPanelProps {
  memories: Memory[];
  onClose: () => void;
  /** Desktop: docked beside the feed. Otherwise a full-screen sheet. */
  isDocked: boolean;
  isAuthenticated: boolean;
  onSignIn: () => void;
  onViewAttachment: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onUpdate?: (id: string, content: string) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  calendarEvents?: CalendarEvent[];
  todoItems?: TodoItem[];
}

const SUGGESTIONS = [
  'What did I save this week?',
  'What are my open action items?',
  'Which places have I saved?',
];

/** Inline **bold** only; everything else is rendered as plain text. */
const InlineText: React.FC<{ value: string }> = ({ value }) => (
  <>
    {value.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        <strong key={i} className="font-semibold text-(--color-text-primary)">{part.slice(2, -2)}</strong>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    )}
  </>
);

/**
 * Renders assistant text as paragraphs and "- " bullet lists. The text is
 * never treated as HTML, so nothing a note or the model contains can inject
 * markup.
 */
const AnswerText: React.FC<{ value: string }> = ({ value }) => {
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ bullets: false, lines: [] });
      continue;
    }
    const bullet = /^[-*•]\s+/.test(line);
    const body = bullet ? line.replace(/^[-*•]\s+/, '') : line;
    const last = blocks[blocks.length - 1];
    if (last && last.lines.length > 0 && last.bullets === bullet) last.lines.push(body);
    else blocks.push({ bullets: bullet, lines: [body] });
  }
  return (
    <div className="flex flex-col gap-2 select-text">
      {blocks.filter(b => b.lines.length > 0).map((b, i) =>
        b.bullets ? (
          <ul key={i} className="list-disc pl-4 flex flex-col gap-1">
            {b.lines.map((l, j) => <li key={j}><InlineText value={l} /></li>)}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((l, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}<InlineText value={l} /></React.Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
};

const AssistantPanel: React.FC<AssistantPanelProps> = ({
  memories, onClose, isDocked, isAuthenticated, onSignIn,
  onViewAttachment, onDelete, onEdit, onUpdate, onTogglePin, calendarEvents, todoItems,
}) => {
  const { messages, status, isBusy, isLoaded, send, stop, reset } = useAssistant(memories);
  const isOnline = useOnlineStatus();
  const [draft, setDraft] = useState('');
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useKeyboardHeight();
  // On a phone the keyboard would cover a restored conversation, so only
  // focus the box straight away when the panel is docked.
  useDeferredAutoFocus(inputRef, { enabled: isDocked });

  // The full-screen sheet scrolls internally; keep the feed behind it still.
  useEffect(() => {
    if (isDocked) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
    };
  }, [isDocked]);

  // Keep the newest message and the progress line in view.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, status, isLoaded]);

  // Grow the box with its content, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  const byId = useMemo(() => new Map(memories.map(m => [m.id, m])), [memories]);
  const previewMemory = previewMemoryId ? byId.get(previewMemoryId) : undefined;

  const canAsk = isOnline && isAuthenticated;
  const canSend = canAsk && !isBusy && draft.trim().length > 0;

  const submit = (value: string) => {
    if (!canAsk || isBusy || !value.trim()) return;
    setDraft('');
    void send(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    } else if (e.key === 'Escape' && !draft) {
      onClose();
    }
  };

  const renderMessage = (m: AssistantMessage) => {
    if (m.role === 'user') {
      return (
        <div key={m.id} className="flex justify-end">
          <p className="max-w-[85%] px-3 py-2 rounded-(--radius-xl) bg-(--color-accent-muted) text-sm text-(--color-text-primary) whitespace-pre-wrap break-words select-text">
            {m.text}
          </p>
        </div>
      );
    }
    const sources = (m.sourceIds || []).map(id => byId.get(id)).filter((n): n is Memory => !!n);
    return (
      <div key={m.id} className="flex flex-col gap-3">
        {m.text && (
          <div className={`text-sm leading-relaxed break-words ${m.isError ? 'text-(--color-danger)' : 'text-(--color-text-primary)'}`}>
            <AnswerText value={m.text} />
          </div>
        )}
        {sources.length > 0 && (
          <section aria-label="Notes used for this answer">
            <h4 className={`${text.label} mb-1`}>From your notes</h4>
            <ul>
              {sources.map(n => (
                <li key={n.id}>
                  <button onClick={() => setPreviewMemoryId(n.id)} className={`${btn.base} ${btn.listRow} py-2`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-(--color-text-secondary) line-clamp-1">{noteTitle(n)}</p>
                      <p className={text.caption}>{formatNoteDate(n.timestamp)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {m.beyondNotes && (
          <section className={`${card.base} p-3`} aria-label="Beyond your notes">
            <h4 className={`${text.label} mb-2`}>Beyond your notes</h4>
            <div className="text-sm leading-relaxed text-(--color-text-secondary) break-words">
              <AnswerText value={m.beyondNotes} />
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col overflow-hidden bg-(--color-surface-base) ${isDocked ? 'border-l border-(--color-border-default)' : ''}`}>
      {/* Header */}
      <div className="flex-none border-b border-(--color-border-default) px-4 pb-3 pt-[calc(0.75rem+var(--sat))] flex items-center gap-2">
        <Sparkles size={18} className="text-(--color-accent-hover) shrink-0" />
        <h2 className={`${text.subheading} flex-1`}>Assistant</h2>
        {messages.length > 0 && (
          <button onClick={reset} className={`${btn.base} ${btn.ghost} gap-1.5 text-xs`}>
            <SquarePen size={14} /> New chat
          </button>
        )}
        <button onClick={onClose} className={overlay.closeBtnRight} aria-label="Close assistant">
          <X size={22} />
        </button>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {isLoaded && messages.length === 0 ? (
          <div className="flex flex-col items-center text-center max-w-sm mx-auto pt-12">
            <Sparkles size={40} className="text-(--color-text-tertiary) mb-4" />
            <p className={text.body}>
              Ask about anything you've saved. Answers come from your notes first, with general knowledge kept separate.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => submit(s)} disabled={!canAsk} className={`${chip.base} ${chip.inactive} font-medium disabled:opacity-50`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-2xl mx-auto">
            {messages.map(renderMessage)}
            {status && (
              <p className={`${text.caption} flex items-center gap-1.5`}>
                <Loader2 size={12} className="animate-spin" /> {status}
              </p>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div
        className="flex-none border-t border-(--color-border-default) px-3 pt-3"
        style={{ paddingBottom: isDocked ? '0.75rem' : 'max(calc(var(--kb-inset, 0px) + 0.75rem), var(--sab))' }}
      >
        {!isOnline ? (
          <p className={`${text.caption} flex items-center gap-1.5 pb-2`}>
            <WifiOff size={12} /> You're offline. The assistant needs a connection.
          </p>
        ) : !isAuthenticated ? (
          <div className="flex items-center gap-3 pb-2">
            <p className={`${text.caption} flex-1`}>Sign in with Google to use the assistant.</p>
            <button onClick={onSignIn} className={`${btn.base} ${btn.primarySm} shrink-0`}>Sign in</button>
          </div>
        ) : null}
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={MAX_QUESTION_LENGTH}
            className={`${input.textarea} text-base`}
            placeholder="Ask about your notes"
            aria-label="Ask about your notes"
            value={draft}
            disabled={!canAsk}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isBusy ? (
            <button onClick={stop} className={`${btn.base} ${btn.secondary} p-2.5 shrink-0`} aria-label="Stop">
              <Square size={18} />
            </button>
          ) : (
            <button
              onClick={() => submit(draft)}
              disabled={!canSend}
              className={`${btn.base} ${canSend ? btn.cta : btn.ctaDisabled}`}
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
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

export default AssistantPanel;
