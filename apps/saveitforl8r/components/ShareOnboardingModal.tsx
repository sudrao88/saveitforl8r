import React from 'react';
import { X, Share, Download } from 'lucide-react';
import { overlay } from '@l8r/shared/design-system';

interface ShareOnboardingModalProps {
  onClose: () => void;
}

const ShareOnboardingModal: React.FC<ShareOnboardingModalProps> = ({ onClose }) => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  return (
    <div className={`${overlay.backdropLight} z-(--z-overlay) flex items-center justify-center p-4 animate-in fade-in duration-(--duration-fast)`}>
      <div className={`${overlay.modal} max-w-sm w-full overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="bg-(--color-surface-overlay)/50 p-4 flex justify-between items-center border-b border-(--color-border-default)">
           <h3 className="text-lg font-bold text-(--color-text-primary) flex items-center gap-2">
               <Share size={20} className="text-(--color-accent)" />
               Easy Sharing
           </h3>
           <button onClick={onClose} className="text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors">
               <X size={20} />
           </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <p className="text-(--color-text-secondary) leading-relaxed">
                    Did you know? You can share images, text, and links directly to <b>SaveItForL8R</b> from other apps.
                </p>
            </div>

            {/* iOS Specific Instructions */}
            {isIOS && (
                <div className="bg-(--color-accent)/10 border border-(--color-accent)/20 rounded-(--radius-xl) p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="bg-(--color-accent) rounded-(--radius-lg) p-2 mt-0.5">
                            <Download size={16} className="text-(--color-text-primary)" />
                        </div>
                        <div>
                            <h4 className="font-bold text-(--color-text-primary) text-sm">iOS Shortcut Required</h4>
                            <p className="text-xs text-(--color-text-secondary)/80 mt-1 leading-relaxed">
                                To share seamlessly on iPhone & iPad, please install our official shortcut.
                            </p>
                        </div>
                    </div>
                    <a 
                        href="https://www.icloud.com/shortcuts/170db1a6c6be402c8d8c18ee8473ee87" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full bg-(--color-accent) hover:bg-(--color-accent-hover) text-(--color-text-primary) text-sm font-bold py-2.5 rounded-(--radius-lg) transition-colors"
                    >
                        <span>Get Shortcut</span>
                        <ExternalLink size={14} />
                    </a>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-(--color-surface-overlay)/30 border-t border-(--color-border-default)">
            <button 
                onClick={onClose}
                className="w-full py-3 bg-(--color-surface-raised) hover:bg-(--color-surface-raised) text-(--color-text-primary) font-medium rounded-(--radius-xl) transition-colors"
            >
                Got it
            </button>
        </div>
      </div>
    </div>
  );
};

// Simple External Link Icon component to avoid adding another import if not present
const ExternalLink = ({ size = 16, className = "" }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
);

export default ShareOnboardingModal;
