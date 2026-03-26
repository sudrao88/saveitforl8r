import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Download, ChevronLeft, ChevronRight, FileText, Share2 } from 'lucide-react';
import { Attachment } from '../types';
import { zIndex } from '../styles/design-system';
import { downloadDataUri } from '../services/downloadService';
import ZoomableImage from './ZoomableImage';
import PdfViewer from './PdfViewer';

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

/** Converts a data URI to a Blob using the Fetch API */
async function dataUriToBlob(dataUri: string): Promise<Blob> {
  const response = await fetch(dataUri);
  return response.blob();
}

/** Downloads an attachment using the cross-platform download service */
async function handleDownload(attachment: Attachment): Promise<void> {
  const safeUri = getSafeDataUri(attachment);
  if (!safeUri) return;
  try {
    await downloadDataUri(safeUri, attachment.name, attachment.mimeType);
  } catch (error) {
    console.error('Failed to download attachment:', error);
  }
}

/** Shares the given attachment using the Web Share API (with file support) */
async function shareAttachment(attachment: Attachment): Promise<void> {
  const safeUri = getSafeDataUri(attachment);
  if (!safeUri) return;

  const blob = await dataUriToBlob(safeUri);
  const file = new File([blob], attachment.name, { type: attachment.mimeType });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: attachment.name,
      });
    } catch (err: unknown) {
      // User cancelled — not an error
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Share failed:', err);
    }
  } else if (navigator.share) {
    // Fallback: share without file (just title)
    try {
      await navigator.share({ title: attachment.name, text: `Shared from SaveItForL8R: ${attachment.name}` });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Share failed:', err);
    }
  }
}

interface GalleryViewerProps {
  attachments: Attachment[];
  initialIndex: number;
  onClose: () => void;
}

const GalleryViewer: React.FC<GalleryViewerProps> = ({ attachments, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const current = attachments[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < attachments.length - 1;
  const isPdf = current.mimeType === 'application/pdf';
  const isImage = current.type === 'image';

  // Check share API support
  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
  }, []);

  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < attachments.length) {
      setCurrentIndex(index);
      setSwipeOffset(0);
      setIsZoomed(false);
    }
  }, [attachments]);

  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && !isZoomed) goPrev();
      else if (e.key === 'ArrowRight' && !isZoomed) goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goPrev, goNext, isZoomed]);

  // Touch/swipe handling (only when not zoomed and not viewing PDF)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isZoomed || isPdf) return;
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isZoomed || isPdf) return;
    if (touchStartX.current === null) return;
    const delta = e.touches[0].clientX - touchStartX.current;
    touchDeltaX.current = delta;
    if ((delta > 0 && hasPrev) || (delta < 0 && hasNext)) {
      setSwipeOffset(delta);
    } else {
      setSwipeOffset(delta * 0.2);
    }
  };

  const handleTouchEnd = () => {
    if (isZoomed || isPdf) return;
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

  const handleShare = useCallback(() => {
    shareAttachment(current);
  }, [current]);

  const renderContent = (attachment: Attachment) => {
    const safeUri = getSafeDataUri(attachment);

    if (attachment.type === 'image') {
      if (!safeUri) return <p className="text-red-400 text-sm">Unable to display this image.</p>;
      return (
        <ZoomableImage
          src={safeUri}
          alt={attachment.name}
          onZoomChange={setIsZoomed}
          resetKey={currentIndex}
        />
      );
    }
    if (attachment.mimeType === 'application/pdf') {
      if (!safeUri) return <p className="text-red-400 text-sm">Unable to display this PDF.</p>;
      return (
        <PdfViewer
          dataUri={safeUri}
          fileName={attachment.name}
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
          <button
            onClick={() => handleDownload(attachment)}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 text-center"
          >
            Download to View
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`fixed inset-0 ${zIndex.tooltip} bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95 duration-(--duration-fast)`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 pt-[var(--sat)]">
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
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
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {canShare && getSafeDataUri(current) && (
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-bold transition-all active:scale-95"
              aria-label="Share"
            >
              <Share2 size={14} /> Share
            </button>
          )}
          {getSafeDataUri(current) && (
            <button
              onClick={() => handleDownload(current)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <Download size={14} /> Download
            </button>
          )}
        </div>
      </div>

      {/* Content area with swipe */}
      <div
        className={`flex-1 flex ${isPdf ? 'flex-col' : 'items-center justify-center'} overflow-hidden relative`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Previous arrow (not shown for PDFs) */}
        {hasPrev && !isPdf && (
          <button
            onClick={goPrev}
            className="absolute left-2 sm:left-4 z-(--z-sticky) p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/70 hover:text-white transition-all active:scale-90 backdrop-blur-sm"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Main content with swipe transform */}
        <div
          className={`flex items-center justify-center ${isPdf ? 'flex-1 overflow-hidden' : 'w-full h-full p-4'}`}
          style={
            isPdf
              ? undefined
              : {
                  transform: `translateX(${swipeOffset}px)`,
                  transition: swipeOffset === 0 ? 'transform 0.25s ease-out' : 'none',
                }
          }
        >
          {renderContent(current)}
        </div>

        {/* Next arrow (not shown for PDFs) */}
        {hasNext && !isPdf && (
          <button
            onClick={goNext}
            className="absolute right-2 sm:right-4 z-(--z-sticky) p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/70 hover:text-white transition-all active:scale-90 backdrop-blur-sm"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Dot indicators (not shown for PDFs) */}
      {!isPdf && attachments.length > 1 && attachments.length <= MAX_DOT_INDICATORS && (
        <div className="flex items-center justify-center gap-1.5 py-3 pb-[calc(0.75rem+var(--sab))]">
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

      {/* Counter for many items (no dots, not shown for PDFs) */}
      {!isPdf && attachments.length > MAX_DOT_INDICATORS && (
        <div className="flex items-center justify-center py-3 pb-[calc(0.75rem+var(--sab))]">
          <span className="text-xs text-gray-500">{currentIndex + 1} / {attachments.length}</span>
        </div>
      )}
    </div>
  );
};

export default GalleryViewer;
