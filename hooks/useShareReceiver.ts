import { useState, useEffect, useCallback } from 'react';
import { Attachment } from '../types';
import { isNative } from '../services/platform';

export interface ShareData {
  text: string;
  attachments: Attachment[];
  checkClipboard?: boolean;
}

export const useShareReceiver = () => {
  const [shareData, setShareData] = useState<ShareData | null>(null);

  // Core logic to check URL and process shares
  const checkForShare = useCallback(async () => {
    // 1. Clean up URL immediately if it matches our params to avoid loops
    // We capture the values first, then clear.
    const searchParams = new URLSearchParams(window.location.search);
    const hasText = searchParams.has('share_text');
    const hasClipboard = searchParams.has('share_image_clipboard');
    const hasShareTarget = searchParams.has('share-target');

    console.log('[ShareReceiver] Checking URL:', window.location.href);

    // --- 1. Native Android Intent (via capacitor-plugin-send-intent) ---
    if (isNative()) {
         try {
             // Access plugin dynamically to avoid importing 'web.js' which breaks build in newer Vite/Capacitor
             const SendIntent = (window as any).Capacitor?.Plugins?.SendIntent;

             if (SendIntent && SendIntent.checkSendIntentReceived) {
                 SendIntent.checkSendIntentReceived().then(async (response: any) => {
                     if (response) {
                         console.log('[ShareReceiver] Native Intent:', response);
                         
                         let text = response.title || response.description || response.text || '';
                         if (response.url && !text.includes(response.url)) {
                            text = text ? `${text}\n${response.url}` : response.url;
                         }
                         
                         const attachments: Attachment[] = [];

                         // Handle Image Share (Content URI)
                         if (response.type?.startsWith('image/') && response.url) {
                             try {
                                 // Fetch blob from content URI (works in WebView for content://)
                                 const fileRes = await fetch(response.url);
                                 const blob = await fileRes.blob();
                                 const reader = new FileReader();
                                 const base64 = await new Promise<string>(r => {
                                     reader.onload = e => r(e.target?.result as string);
                                     reader.readAsDataURL(blob);
                                 });
                                 
                                 attachments.push({
                                     id: crypto.randomUUID(),
                                     type: 'image',
                                     mimeType: response.type,
                                     data: base64,
                                     name: 'Shared Image'
                                 });
                             } catch (e) {
                                 console.error("Failed to read native attachment", e);
                             }
                         }
                         // Handle Text Share
                         else if (response.type === 'text/plain' && response.text) {
                             // already handled above
                         }

                         if (text || attachments.length > 0) {
                            setShareData({ text: text.trim(), attachments });
                         }
                     }
                 }).catch((err: any) => console.warn('SendIntent check failed', err));
             }
         } catch (e) {
             console.warn("SendIntent plugin error", e);
         }
    }

    // --- 2. iOS / Direct URL Text Share ---
    if (hasText) {
        let text = searchParams.get('share_text') || '';
        
        // ROBUST DECODING FALLBACK
        try {
            const rawSearch = window.location.search;
            const match = rawSearch.match(/[?&]share_text=([^&]*)/);
            if (match && match[1]) {
                const rawValue = match[1];
                text = decodeURIComponent(rawValue.replace(/\+/g, ' '));
                console.log('[ShareReceiver] Manual decode result:', text);
            }
        } catch (e) {
            console.warn('[ShareReceiver] Manual decode failed, using standard param:', e);
        }

        console.log('[ShareReceiver] Final text detected:', text);
        setShareData({ text, attachments: [] });
        
        window.history.replaceState({}, '', '/');
        return;
    }

    // --- 3. iOS / Direct URL Clipboard Share ---
    if (hasClipboard) {
        console.log('[ShareReceiver] Detected clipboard share');
        setShareData({ text: '', attachments: [], checkClipboard: true });
        
        window.history.replaceState({}, '', '/');
        return;
    }

    // --- 4. Android Web Share Target (IndexedDB - PWA Mode) ---
    if (hasShareTarget) {
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
                 window.history.replaceState({}, '', '/');
                 return;
            }

            const tx = db.transaction('shares', 'readwrite');
            const store = tx.objectStore('shares');
            const getAllReq = store.getAll();

            getAllReq.onsuccess = async () => {
                const shares = getAllReq.result;
                if (shares && shares.length > 0) {
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
                    
                    const clearTx = db.transaction('shares', 'readwrite');
                    clearTx.objectStore('shares').clear();
                }
                window.history.replaceState({}, '', '/');
            };
            
            getAllReq.onerror = () => {
                 window.history.replaceState({}, '', '/');
            };

        } catch (e) {
            console.error("[ShareReceiver] IDB Error:", e);
            window.history.replaceState({}, '', '/');
        }
    }
  }, []);

  useEffect(() => {
    checkForShare();

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            setTimeout(checkForShare, 100);
        }
    };

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
