import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  onZoomChange?: (isZoomed: boolean) => void;
  resetKey?: number; // Change this to reset zoom (e.g., when navigating)
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_THRESHOLD_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;

const ZoomableImage: React.FC<ZoomableImageProps> = ({ src, alt, onZoomChange, resetKey }) => {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Touch tracking refs
  const lastTapTime = useRef(0);
  const lastTapPos = useRef({ x: 0, y: 0 });
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);
  const isPanning = useRef(false);

  // Reset zoom when navigating to a different image
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    onZoomChange?.(false);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    if (s <= 1) return { x: 0, y: 0 };
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return { x: tx, y: ty };

    const cRect = container.getBoundingClientRect();
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    // Calculate displayed image size (object-contain)
    const containerAspect = cRect.width / cRect.height;
    const imgAspect = imgW / imgH;
    let displayW: number, displayH: number;
    if (imgAspect > containerAspect) {
      displayW = cRect.width;
      displayH = cRect.width / imgAspect;
    } else {
      displayH = cRect.height;
      displayW = cRect.height * imgAspect;
    }

    const scaledW = displayW * s;
    const scaledH = displayH * s;
    const maxTx = Math.max(0, (scaledW - cRect.width) / 2);
    const maxTy = Math.max(0, (scaledH - cRect.height) / 2);

    return {
      x: Math.max(-maxTx, Math.min(maxTx, tx)),
      y: Math.max(-maxTy, Math.min(maxTy, ty)),
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      isPinching.current = true;
      isPanning.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartScale.current = scale;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dt = now - lastTapTime.current;
      const dist = Math.hypot(x - lastTapPos.current.x, y - lastTapPos.current.y);

      // Check for double-tap
      if (dt < DOUBLE_TAP_THRESHOLD_MS && dist < DOUBLE_TAP_DISTANCE_PX) {
        e.preventDefault();
        lastTapTime.current = 0; // Reset to avoid triple-tap
        setIsAnimating(true);
        if (scale > 1) {
          // Zoom out
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomChange?.(false);
        } else {
          // Zoom in toward tap point
          const container = containerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const tapX = x - rect.left;
            const tapY = y - rect.top;
            const newTx = (cx - tapX) * (DOUBLE_TAP_SCALE - 1);
            const newTy = (cy - tapY) * (DOUBLE_TAP_SCALE - 1);
            const clamped = clampTranslate(newTx, newTy, DOUBLE_TAP_SCALE);
            setScale(DOUBLE_TAP_SCALE);
            setTranslate(clamped);
            onZoomChange?.(true);
          }
        }
        setTimeout(() => setIsAnimating(false), 300);
        return;
      }

      lastTapTime.current = now;
      lastTapPos.current = { x, y };

      // Start pan if zoomed
      if (scale > 1) {
        isPanning.current = true;
        panStart.current = { x, y };
        translateStart.current = { ...translate };
        e.preventDefault();
      }
    }
  }, [scale, translate, clampTranslate, onZoomChange]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPinching.current && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchStartDist.current;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale.current * ratio));
      setScale(newScale);
      if (newScale <= 1) {
        setTranslate({ x: 0, y: 0 });
        onZoomChange?.(false);
      } else {
        setTranslate(prev => clampTranslate(prev.x, prev.y, newScale));
        onZoomChange?.(true);
      }
    } else if (isPanning.current && e.touches.length === 1 && scale > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      const newTx = translateStart.current.x + dx;
      const newTy = translateStart.current.y + dy;
      setTranslate(clampTranslate(newTx, newTy, scale));
    }
  }, [scale, clampTranslate, onZoomChange]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      isPinching.current = false;
      isPanning.current = false;
      // Snap back to 1x if close
      if (scale < 1.1 && scale !== 1) {
        setIsAnimating(true);
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        onZoomChange?.(false);
        setTimeout(() => setIsAnimating(false), 300);
      }
    }
    if (e.touches.length < 2) {
      isPinching.current = false;
    }
  }, [scale, onZoomChange]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: scale > 1 ? 'none' : 'pan-y' }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg select-none"
        draggable={false}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: isAnimating ? 'transform 0.3s ease-out' : 'none',
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
};

export default ZoomableImage;
