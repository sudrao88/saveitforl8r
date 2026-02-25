/**
 * MomentSheet.tsx
 *
 * Full-screen synthesis detail sheet. Opens when user taps a Moment bubble.
 * Handles loading, caching, synthesis display, inline feedback, and item completion.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Loader2,
  Clock,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Check,
} from 'lucide-react';
import {
  MomentCluster,
  MomentMeta,
  SynthesisResponse,
  SynthesisSection,
  SynthesisItem,
  Memory,
} from '../types';

interface MomentSheetProps {
  cluster: MomentCluster;
  memories: Memory[];
  meta?: MomentMeta;
  onClose: () => void;
  loadSynthesis: (cluster: MomentCluster, memories: Memory[]) => Promise<SynthesisResponse | null>;
  onMarkViewed: (momentId: string) => Promise<void>;
  onDismiss: (momentId: string) => Promise<void>;
  onFrequencyOverride: (momentId: string, override: 'more' | 'less' | null) => Promise<void>;
}

const MomentSheet: React.FC<MomentSheetProps> = ({
  cluster,
  memories,
  meta,
  onClose,
  loadSynthesis,
  onMarkViewed,
  onDismiss,
  onFrequencyOverride,
}) => {
  const [synthesis, setSynthesis] = useState<SynthesisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());

  // Load synthesis on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const result = await loadSynthesis(cluster, memories);
        if (!cancelled) {
          setSynthesis(result);
          if (!result) setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    onMarkViewed(cluster.id);

    return () => {
      cancelled = true;
    };
  }, [cluster.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(async () => {
    setIsLoading(true);
    setError(false);
    try {
      const result = await loadSynthesis(cluster, memories);
      setSynthesis(result);
      if (!result) setError(true);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [cluster, memories, loadSynthesis]);

  const toggleItemComplete = useCallback((itemKey: string) => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

  const handleDismiss = useCallback(() => {
    onDismiss(cluster.id);
    onClose();
  }, [cluster.id, onDismiss, onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-gray-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-950/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-3 -ml-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors active:scale-95"
          >
            <X size={24} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-100 truncate max-w-[200px] sm:max-w-md">
              {cluster.title}
            </h2>
            {synthesis?.subtitle && (
              <p className="text-xs text-gray-400">{synthesis.subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{cluster.noteIds.length} notes</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-8 pb-32">
          {isLoading && (
            <div className="space-y-6 animate-pulse">
              {/* Skeleton UI */}
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-3">
                  <div className="h-6 bg-gray-800 rounded-lg w-48" />
                  <div className="space-y-2">
                    <div className="h-14 bg-gray-800/60 rounded-xl" />
                    <div className="h-14 bg-gray-800/60 rounded-xl" />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center gap-2 pt-4">
                <Loader2 size={20} className="animate-spin text-blue-400" />
                <span className="text-sm text-gray-400">Synthesizing moment...</span>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <X size={32} className="text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-200 mb-2">
                Synthesis failed
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Could not generate the moment. Check your connection and try again.
              </p>
              <button
                onClick={handleRetry}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors active:scale-95"
              >
                Retry
              </button>
            </div>
          )}

          {synthesis && !isLoading && (
            <>
              {/* Sections */}
              <div className="space-y-6">
                {synthesis.sections.map((section, sIdx) => (
                  <SectionView
                    key={sIdx}
                    section={section}
                    sectionIndex={sIdx}
                    completedItems={completedItems}
                    onToggleComplete={toggleItemComplete}
                  />
                ))}
              </div>

              {/* Frequency Feedback */}
              <div className="mt-8 pt-6 border-t border-gray-800">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  <Clock size={14} />
                  <span>Show me this:</span>
                </div>
                <div className="flex gap-2">
                  <FeedbackButton
                    label="More often"
                    icon={<ChevronUp size={14} />}
                    active={meta?.frequencyOverride === 'more'}
                    onClick={() =>
                      onFrequencyOverride(
                        cluster.id,
                        meta?.frequencyOverride === 'more' ? null : 'more'
                      )
                    }
                  />
                  <FeedbackButton
                    label="Less often"
                    icon={<ChevronDown size={14} />}
                    active={meta?.frequencyOverride === 'less'}
                    onClick={() =>
                      onFrequencyOverride(
                        cluster.id,
                        meta?.frequencyOverride === 'less' ? null : 'less'
                      )
                    }
                  />
                  <FeedbackButton
                    label="Not now"
                    onClick={handleDismiss}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Section Component ---

const SectionView: React.FC<{
  section: SynthesisSection;
  sectionIndex: number;
  completedItems: Set<string>;
  onToggleComplete: (key: string) => void;
}> = ({ section, sectionIndex, completedItems, onToggleComplete }) => (
  <div>
    <h3 className="text-base font-bold text-gray-200 mb-3 flex items-center gap-2">
      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
      {section.heading}
    </h3>
    <div className="space-y-2">
      {section.items.map((item, iIdx) => {
        const key = `${sectionIndex}-${iIdx}`;
        const isCompleted =
          item.completed || completedItems.has(key);
        return (
          <ItemView
            key={key}
            item={item}
            isCompleted={isCompleted}
            completable={item.completable !== false}
            onToggle={() => onToggleComplete(key)}
          />
        );
      })}
    </div>
  </div>
);

// --- Item Component ---

const ItemView: React.FC<{
  item: SynthesisItem;
  isCompleted: boolean;
  completable: boolean;
  onToggle: () => void;
}> = ({ item, isCompleted, completable, onToggle }) => (
  <div
    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
      isCompleted
        ? 'bg-gray-800/30 border-gray-800 opacity-60'
        : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600/50'
    }`}
  >
    {completable && (
      <button
        onClick={onToggle}
        className="shrink-0 mt-0.5"
      >
        <div
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
            isCompleted
              ? 'border-blue-500 bg-blue-500/20'
              : 'border-gray-600 hover:border-gray-400'
          }`}
        >
          {isCompleted && <Check size={12} className="text-blue-400" />}
        </div>
      </button>
    )}
    <div className="flex-1 min-w-0">
      <p
        className={`text-sm font-medium ${
          isCompleted ? 'line-through text-gray-500' : 'text-gray-200'
        }`}
      >
        {item.label}
      </p>
      {item.detail && (
        <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
      )}
    </div>
    {item.link && (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <ExternalLink size={14} />
      </a>
    )}
  </div>
);

// --- Feedback Button ---

const FeedbackButton: React.FC<{
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}> = ({ label, icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all active:scale-95 ${
      active
        ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200'
    }`}
  >
    {icon}
    {label}
  </button>
);

export default MomentSheet;
