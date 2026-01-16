
import React, { useState, useEffect } from 'react';
import { X, Share } from 'lucide-react';
import { Logo } from './icons';

export const InstallPrompt: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    if (isStandalone) return;

    const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Check if mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    // Check if iOS
    const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    // Show prompt if mobile and not standalone
    const hasDismissed = localStorage.getItem('install_prompt_dismissed');

    if (isMobile && !hasDismissed) {
      setShowPrompt(true);
    }

    return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('install_prompt_dismissed', 'true');
    setDeferredPrompt(null);
  };

  const handleInstall = async () => {
      if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
              setDeferredPrompt(null);
              setShowPrompt(false);
          }
      } else {
          setShowInstructions(!showInstructions);
      }
  }

  if (!showPrompt) return null;

  return (
    <div className="bg-gray-800 border-b border-gray-700 relative z-50">
      {!showInstructions ? (
          <div className="flex items-center p-3 gap-3">
            <button 
              onClick={handleDismiss}
              className="text-gray-400 hover:text-white p-1 -ml-1"
            >
              <X size={18} />
            </button>

            <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-blue-600 flex items-center justify-center">
                 <Logo className="w-full h-full" />
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-white font-medium text-sm leading-tight truncate">SaveItForL8r</h3>
              <p className="text-gray-400 text-xs leading-tight truncate">Personal Second Brain</p>
            </div>

            <button
               onClick={handleInstall}
               className="shrink-0 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold px-4 py-1.5 rounded-full transition-colors"
            >
              {deferredPrompt ? 'Install' : 'Get'}
            </button>
          </div>
      ) : (
          <div className="p-4 bg-gray-800 animate-in fade-in slide-in-from-top-2">
             <div className="flex items-start justify-between mb-3">
                <span className="text-white font-medium text-sm">Install Instructions</span>
                <button onClick={() => setShowInstructions(false)} className="text-gray-400 hover:text-white">
                    <X size={18} />
                </button>
             </div>
             
             {isIOS ? (
               <div className="text-sm text-gray-300 space-y-2">
                 <p className="flex items-center gap-2">
                   1. Tap the Share button <Share size={16} className="text-blue-400" />
                 </p>
                 <p className="flex items-center gap-2">
                   2. Select "Add to Home Screen" <span className="border border-gray-600 rounded px-1 text-xs bg-gray-700">+</span>
                 </p>
               </div>
             ) : (
               <div className="text-sm text-gray-300 space-y-2">
                 <p>1. Tap the browser menu (three dots)</p>
                 <p>2. Select "Install App"</p>
               </div>
             )}
          </div>
      )}
    </div>
  );
};
