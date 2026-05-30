import React, { useState, useEffect } from 'react';
import { Share, X } from 'lucide-react';
import { Logo } from './icons';
import { btn } from '@l8r/shared/design-system';

export const InstallPrompt = () => {
  const [showPrompt, setShowPrompt] = useState(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      return false;
    }
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const dismissed = localStorage.getItem('install_prompt_dismissed');
    return isMobile && !dismissed;
  });
  const [isIOS] = useState(() => /iPhone|iPad|iPod/i.test(navigator.userAgent));
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const dismiss = () => {
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
        // Fallback or iOS instructions
        setShowInstructions(!showInstructions);
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="bg-(--color-surface-raised) border-b border-(--color-border-default) relative z-(--z-overlay)">
      {showInstructions ? (
         <div className="p-4 bg-(--color-surface-raised) animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start justify-between mb-3">
                <span className="text-(--color-text-primary) font-medium text-sm">Install Instructions</span>
                <button onClick={() => setShowInstructions(false)} className={btn.icon}>
                    <X size={18} />
                </button>
            </div>
            {isIOS ? (
                <div className="text-sm text-(--color-text-secondary) space-y-2">
                    <p className="flex items-center gap-2">1. Tap the Share button <Share size={16} className="text-(--color-accent)" /></p>
                    <p className="flex items-center gap-2">2. Select "Add to Home Screen" <span className="border border-(--color-border-default) rounded px-1 text-xs bg-(--color-surface-raised)">+</span></p>
                </div>
            ) : (
                <div className="text-sm text-(--color-text-secondary) space-y-2">
                    <p>1. Tap the browser menu (three dots)</p>
                    <p>2. Select "Install App"</p>
                </div>
            )}
         </div>
      ) : (
        <div className="flex items-center p-3 gap-3">
            <button onClick={dismiss} className={`${btn.icon} -ml-1`}>
                <X size={18} />
            </button>
            <div className="shrink-0 w-10 h-10 rounded-(--radius-lg) overflow-hidden bg-(--color-surface-overlay) flex items-center justify-center">
                <Logo className="w-full h-full" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <h3 className="text-(--color-text-primary) font-medium text-sm leading-tight truncate">SaveItForL8R</h3>
                <p className="text-(--color-text-secondary) text-xs leading-tight truncate">Personal Second Brain</p>
            </div>
            <button
                onClick={handleInstall}
                className={`${btn.base} ${btn.primary} shrink-0 text-xs px-4 py-1.5 rounded-full`}
            >
                {deferredPrompt ? 'Install' : 'Get'}
            </button>
        </div>
      )}
    </div>
  );
};
