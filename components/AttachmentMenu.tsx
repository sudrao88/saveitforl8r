import React, { useRef, useEffect } from 'react';
import { Camera, Image, FileText } from 'lucide-react';
import { menu } from '../styles/design-system';

interface AttachmentMenuProps {
  open: boolean;
  onClose: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const AttachmentMenu: React.FC<AttachmentMenuProps> = ({ open, onClose, onFileSelect }) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  const handleSelect = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.click();
    onClose();
  };

  return (
    <div ref={menuRef} className="relative">
      <div className={menu.panel}>
        <button
          className={menu.item}
          onClick={() => handleSelect(cameraInputRef)}
        >
          <Camera size={18} />
          Take photo
        </button>
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

      <input
        type="file"
        ref={cameraInputRef}
        onChange={onFileSelect}
        className="hidden"
        accept="image/*"
        capture="environment"
      />
      <input
        type="file"
        ref={imageInputRef}
        onChange={onFileSelect}
        className="hidden"
        multiple
        accept="image/*"
      />
      <input
        type="file"
        ref={docInputRef}
        onChange={onFileSelect}
        className="hidden"
        multiple
        accept=".pdf,.txt,.md"
      />
    </div>
  );
};

export default AttachmentMenu;
