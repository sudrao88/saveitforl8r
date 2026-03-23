import React, { useRef, useEffect, useCallback } from 'react';
import { Camera, Image, FileText } from 'lucide-react';
import { menu } from '../styles/design-system';

interface AttachmentMenuProps {
  open: boolean;
  onClose: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Show the camera option on devices with a camera (mobile/tablet). */
const hasCameraSupport = () =>
  'ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches;

const AttachmentMenu: React.FC<AttachmentMenuProps> = ({ open, onClose, onFileSelect }) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open, onClose]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onFileSelect(e);
    // The parent handler resets e.target.value after processing completes.
    // Do NOT reset it here — onFileSelect is async and the FileList may be
    // invalidated before files are read if we clear it synchronously.
  }, [onFileSelect]);

  const handleSelect = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.click();
    onClose();
  };

  const showCamera = hasCameraSupport();

  return (
    <div ref={menuRef}>
      {/* Hidden file inputs rendered BEFORE the conditional menu panel so their
          position in the React tree is stable. If they came after {open && ...},
          toggling `open` would shift their tree positions, causing React to
          unmount/remount them and breaking the browser file picker association. */}
      {showCamera && (
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/*"
          capture="environment"
        />
      )}
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept="image/*"
      />
      <input
        type="file"
        ref={docInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept=".pdf,.txt,.md"
      />

      {open && (
        <div className={`${menu.panel} !right-auto left-0`}>
          {showCamera && (
            <button
              className={menu.item}
              onClick={() => handleSelect(cameraInputRef)}
            >
              <Camera size={18} />
              Take photo
            </button>
          )}
          <button
            className={menu.item}
            onClick={() => handleSelect(imageInputRef)}
          >
            <Image size={18} />
            Upload image
          </button>
          <button
            className={menu.item}
            onClick={() => handleSelect(docInputRef)}
          >
            <FileText size={18} />
            Upload document
          </button>
        </div>
      )}
    </div>
  );
};

export default AttachmentMenu;
