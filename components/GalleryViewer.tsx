import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Download, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Attachment } from '../types';

const MAX_DOT_INDICATORS = 12;

const SAFE_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/avif',
]);

/** Returns a safe src URL for the attachment, or empty string if the data URI is suspicious. */
function getSafeDataUri(attachment: Attachment): string {
  const { data, mimeType } = attachment;
  // Block javascript:, vbscript:, and other dangerous schemes
  if (!/^data:/i.test(data)) return '';
  if (attachment.type === 'image') {
    // Validate the data URI declares an image MIME type
    const match = data.match(/^data:([^;,]+)/i);
    if (!match || !SAFE_IMAGE_MIMES.has(match[1].toLowerCase())) return '';
  } else if (mimeType === 'application/pdf') {
    const match = data.match(/^data:([^;,]+)/i);
    if (!match || match[1].toLowerCase() !== 'application/pdf') return '';
  }
  return data;
}

interface GalleryViewerProps {
  attachments: Attachment[];
  initialIndex: number;
  onClose: () => void;
}

const GalleryViewer: React.FC<GalleryViewerProps> = ({ attachments, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const current = attachments[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < attachments.length - 1;

  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < attachments.length) {
      setCurrentIndex(index);
      setSwipeOffset(0);
    }
  }, [attachments]);

  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goPrev, goNext]);

  // Touch/swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.touches[0].clientX - touchStartX.current;
    touchDeltaX.current = delta;
    // Only show swipe offset if swiping in a valid direction
    if ((delta > 0 && hasPrev) || (delta < 0 && hasNext)) {
      setSwipeOffset(delta);
    } else {
      // Dampen swipe at edges
      setSwipeOffset(delta * 0.2);
    }
  };

  const handleTouchEnd = () => {
    const threshold = 60;
    if (touchDeltaX.current < -threshold && hasNext) {
      goNext();
    } else if (touchDeltaX.current > threshold && hasPrev) {
      goPrev();
    } else {
      setSwipeOffset(0);
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  const renderContent = (attachment: Attachment) => {
    const safeUri = getSafeDataUri(attachment);

    if (attachment.type === 'image') {
      if (!safeUri) return <p className="text-red-400 text-sm">Unable to display this image.</p>;
      return (
        <img
          src={safeUri}
          alt={attachment.name}
          className="max-w-full max-h-full object-contain shadow-2xl rounded-lg select-none"
          draggable={false}
        />
      );
    }
    if (attachment.mimeType === 'application/pdf') {
      if (!safeUri) return <p className="text-red-400 text-sm">Unable to display this PDF.</p>;
      return (
        <iframe
          src={safeUri}
          className="w-full h-full rounded-lg bg-white shadow-2xl border-none"
          title={attachment.name}
          sandbox="allow-same-origin"
        />
      );
    }
    return (
      <div className="bg-gray-900 border border-gray-800 p-8 rounded-2xl flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center">
          <FileText size={32} className="text-blue-400" />
        </div>
        <div>
          <h3 className="text-gray-100 font-bold mb-1">{attachment.name}</h3>
          <p className="text-gray-400 text-xs">Preview not available for this file type.</p>
        </div>
        {safeUri && (
          <a
            href={safeUri}
            download={attachment.name}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 text-center"
          >
            Download to View
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-3 -ml-3 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors active:scale-95 shrink-0"
          >
            <X size={24} />
          </button>
          <span className="text-sm font-medium text-gray-200 truncate">{current.name}</span>
          {attachments.length > 1 && (
            <span className="text-xs text-gray-500 shrink-0">{currentIndex + 1} of {attachments.length}</span>
          )}
        </div>
        {getSafeDataUri(current) && (
          <a
            href={getSafeDataUri(current)}
            download={current.name}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shrink-0"
          >
            <Download size={14} /> Download
          </a>
        )}
      </div>

      {/* Content area with swipe */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Previous arrow */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute left-2 sm:left-4 z-10 p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/70 hover:text-white transition-all active:scale-90 backdrop-blur-sm"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Main content with swipe transform */}
        <div
          className="flex items-center justify-center w-full h-full p-4"
          style={{
            transform: `translateX(${swipeOffset}px)`,
            transition: swipeOffset === 0 ? 'transform 0.25s ease-out' : 'none',
          }}
        >
          {renderContent(current)}
        </div>

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute right-2 sm:right-4 z-10 p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/70 hover:text-white transition-all active:scale-90 backdrop-blur-sm"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Dot indicators */}
      {attachments.length > 1 && attachments.length <= MAX_DOT_INDICATORS && (
        <div className="flex items-center justify-center gap-1.5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {attachments.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goTo(idx)}
              className={`rounded-full transition-all ${
                idx === currentIndex
                  ? 'w-2.5 h-2.5 bg-blue-500'
                  : 'w-2 h-2 bg-gray-600 hover:bg-gray-400'
              }`}
            />
          ))}
        </div>
      )}

      {/* Counter for many items (no dots) */}
      {attachments.length > MAX_DOT_INDICATORS && (
        <div className="flex items-center justify-center py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <span className="text-xs text-gray-500">{currentIndex + 1} / {attachments.length}</span>
        </div>
      )}
    </div>
  );
};

export default GalleryViewer;
