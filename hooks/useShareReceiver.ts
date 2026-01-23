import { useState, useEffect, useCallback } from 'react';
import { Attachment } from '../types';

export interface ShareData {
  text: string;
  attachments: Attachment[];
  checkClipboard?: boolean;
}

export const useShareReceiver = () => {
  const [shareData, setShareData] = useState<ShareData | null>(null);

  // Core logic to check URL and process shares
  const checkForShare = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search);
    
    // --- 1. iOS / Direct URL Text Share ---
    if (searchParams.has('share_text')) {
        const text = searchParams.get('share_text') || '';
        console.log('[ShareReceiver] Detected text share');
        
        setShareData({ text, attachments: [] });
        
        // Clean URL immediately to prevent re-processing
        window.history.replaceState({}, '', '/');
        return;
    }

    // --- 2. iOS / Direct URL Clipboard Share ---
    if (searchParams.has('share_image_clipboard')) {
        console.log('[ShareReceiver] Detected clipboard share');
        
        setShareData({ text: '', attachments: [], checkClipboard: true });
        
        // Clean URL immediately
        window.history.replaceState({}, '', '/');
        return;
    }

    // --- 3. Android Web Share Target (IndexedDB) ---
    if (searchParams.has('share-target')) {
        console.log('[ShareReceiver] Detected Android share target');
        
        try {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('saveitforl8r-share', 1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onupgradeneeded = (e: any) => {
                     const db = e.target.result;
                     if (!db.objectStoreNames.contains('shares')) {
                        db.createObjectStore('shares', { autoIncrement: true });
                     }
                };
            });

            if (!db.objectStoreNames.contains('shares')) {
                 // Even if invalid, clean URL to escape loop
                 window.history.replaceState({}, '', '/');
                 return;
            }

            const tx = db.transaction('shares', 'readwrite');
            const store = tx.objectStore('shares');
            const getAllReq = store.getAll();

            getAllReq.onsuccess = async () => {
                const shares = getAllReq.result;
                if (shares && shares.length > 0) {
                    // Process the most recent share
                    const latestShare = shares[shares.length - 1];
                    
                    let text = latestShare.text || '';
                    const title = latestShare.title || '';
                    const url = latestShare.url || '';
                    
                    if (title) text = `${title}\n${text}`;
                    if (url) text = `${text}\n${url}`;

                    const attachments: Attachment[] = [];
                    if (latestShare.files && latestShare.files.length > 0) {
                        for (const f of latestShare.files) {
                             const blob = f.blob || f;
                             if (!(blob instanceof Blob)) continue;

                             const reader = new FileReader();
                             const base64 = await new Promise<string>((resolve) => {
                                reader.onload = (e) => resolve(e.target?.result as string);
                                reader.readAsDataURL(blob);
                             });
                             
                             attachments.push({
                                 id: crypto.randomUUID(),
                                 type: blob.type.startsWith('image/') ? 'image' : 'file',
                                 mimeType: blob.type,
                                 data: base64,
                                 name: f.name || 'Shared File'
                             });
                        }
                    }

                    setShareData({ text: text.trim(), attachments });

                    // Clear IDB
                    const clearTx = db.transaction('shares', 'readwrite');
                    clearTx.objectStore('shares').clear();
                }
                // Clean URL after processing
                window.history.replaceState({}, '', '/');
            };
            
            getAllReq.onerror = () => {
                console.error('[ShareReceiver] Error reading shares');
                window.history.replaceState({}, '', '/');
            };

        } catch (e) {
            console.error("[ShareReceiver] IDB Error:", e);
            window.history.replaceState({}, '', '/');
        }
    }
  }, []);

  useEffect(() => {
    // 1. Check immediately on mount
    checkForShare();

    // 2. Listener for PWA coming to foreground (iOS specific robustness)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            // Slight delay to allow the browser to update window.location from the deep link
            setTimeout(checkForShare, 100);
        }
    };

    // 3. Listener for Window Focus (Desktop/Android robustness)
    const handleFocus = () => {
        setTimeout(checkForShare, 100);
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
    };
  }, [checkForShare]);

  return { shareData, clearShareData: () => setShareData(null) };
};
