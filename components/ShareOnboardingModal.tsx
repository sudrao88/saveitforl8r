import React from 'react';
import { X, Share, Download, ExternalLink } from 'lucide-react';

interface ShareOnboardingModalProps {
  onClose: () => void;
}

const ShareOnboardingModal: React.FC<ShareOnboardingModalProps> = ({ onClose }) => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-gray-900/50 p-4 flex justify-between items-center border-b border-gray-700">
            <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                <Share size={20} className="text-blue-400" />
                Easy Sharing
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X size={20} />
            </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <p className="text-gray-300 leading-relaxed">
                    Did you know? You can share images, text, and links directly to <b>SaveItForL8r</b> from other apps.
                </p>
            </div>

            {isIOS && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="bg-blue-500 rounded-lg p-2 mt-0.5">
                            <Download size={16} className="text-white" />
                        </div>
                        <div>
                            <h4 className="font-bold text-blue-100 text-sm">iOS Shortcut Required</h4>
                            <p className="text-xs text-blue-200/80 mt-1 leading-relaxed">
                                To share seamlessly on iPhone & iPad, please install our official shortcut.
                            </p>
                        </div>
                    </div>
                    
                    <a 
                        href="https://www.icloud.com/shortcuts/170db1a6c6be402c8d8c18ee8473ee87"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-lg transition-colors"
                    >
                        <span>Get Shortcut</span>
                        <ExternalLink size={14} />
                    </a>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-900/30 border-t border-gray-700">
            <button 
                onClick={onClose}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-xl transition-colors"
            >
                Got it
            </button>
        </div>
      </div>
    </div>
  );
};

export default ShareOnboardingModal;
