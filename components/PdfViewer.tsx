import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ZoomIn, ZoomOut, Loader } from 'lucide-react';
import { zIndex } from '../styles/design-system';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  dataUri: string;
  fileName: string;
}

// Render scale for canvas (higher = sharper but more memory)
const RENDER_SCALE = 2;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface PageData {
  dataUrl: string;
  width: number;
  height: number;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ dataUri, fileName }) => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pinch-to-zoom refs
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const isPinching = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setLoadingProgress(0);
        setPages([]);

        const response = await fetch(dataUri);
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (cancelled) return;
        setTotalPages(pdf.numPages);

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;

          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            console.error(`Failed to get 2d context for page ${i}`);
            continue;
          }
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;

          const pageData: PageData = {
            dataUrl: canvas.toDataURL('image/png'),
            width: viewport.width,
            height: viewport.height,
          };

          if (!cancelled) {
            // Update pages incrementally so users see pages as they render
            setPages(prev => [...prev, pageData]);
            setLoadingProgress(Math.round((i / pdf.numPages) * 100));
            if (i === 1) setLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load PDF:', err);
          setError('Failed to load PDF. The file may be corrupted.');
          setLoading(false);
        }
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [dataUri]);

  const zoomIn = useCallback(() => setZoom(z => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  // Pinch-to-zoom handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartZoom.current = zoom;
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPinching.current && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchStartDist.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom.current * ratio));
      setZoom(newZoom);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isPinching.current = false;
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-center p-8">
        <Loader size={32} className="text-blue-400 animate-spin" />
        <div>
          <p className="text-gray-200 font-medium text-sm">Loading PDF...</p>
          <p className="text-gray-500 text-xs mt-1">
            {loadingProgress > 0 ? `${loadingProgress}%` : 'Preparing...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full">
      {/* Zoom controls */}
      <div className={`flex items-center justify-center gap-2 py-2 bg-black/50 backdrop-blur-sm border-b border-white/10 shrink-0 ${zIndex.sticky}`}>
        <button
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        <button
          onClick={resetZoom}
          className="px-3 py-1 rounded-lg hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors min-w-[4rem]"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
        <span className="text-xs text-gray-500 ml-2">{totalPages} {totalPages === 1 ? 'page' : 'pages'}</span>
      </div>

      {/* Scrollable page container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex flex-col items-center gap-4 p-4 pb-8"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            width: zoom > 1 ? `${100 / zoom}%` : '100%',
          }}
        >
          {pages.map((page, idx) => (
            <div key={idx} className="w-full max-w-2xl relative">
              <img
                src={page.dataUrl}
                alt={`${fileName} - Page ${idx + 1}`}
                className="w-full shadow-xl rounded-sm bg-white"
                draggable={false}
              />
              <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full backdrop-blur-sm">
                {idx + 1} / {totalPages}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PdfViewer;
