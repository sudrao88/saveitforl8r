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

  // Native Intent Check (Async & Retryable)
  const checkNativeIntent = useCallback(async (): Promise<boolean> => {
      if (!isNative()) return false;
      try {
         const SendIntent = (window as any).Capacitor?.Plugins?.SendIntent;
         if (!SendIntent || !SendIntent.checkSendIntentReceived) return false;

         const response = await SendIntent.checkSendIntentReceived();
         if (response) {
             console.log('[ShareReceiver] Native Intent:', JSON.stringify(response));
             
             let text = response.title || response.description || response.text || '';
             if (response.url && !text.includes(response.url)) {
                text = text ? `${text}\n${response.url}` : response.url;
             }
             
             const attachments: Attachment[] = [];

             if (response.type?.startsWith('image/') && response.url) {
                 try {
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

             if (text || attachments.length > 0) {
                setShareData({ text: text.trim(), attachments });
                return true;
             }
         }
      } catch (e) {
         console.warn("SendIntent plugin error", e);
      }
      return false;
  }, []);

  // Web Logic
  const checkForWebShare = useCallback(async () => {
    if (isNative()) return; // Skip web checks on native to avoid conflicts

    const searchParams = new URLSearchParams(window.location.search);
    const hasText = searchParams.has('share_text');
    const hasClipboard = searchParams.has('share_image_clipboard');
    const hasShareTarget = searchParams.has('share-target');

    if (hasText) {
        let text = searchParams.get('share_text') || '';
        try {
            const rawSearch = window.location.search;
            const match = rawSearch.match(/[?&]share_text=([^&]*)/);
            if (match && match[1]) {
                const rawValue = match[1];
                text = decodeURIComponent(rawValue.replace(/\+/g, ' '));
            }
        } catch (e) { console.warn(e); }

        setShareData({ text, attachments: [] });
        window.history.replaceState({}, '', '/');
        return;
    }

    if (hasClipboard) {
        setShareData({ text: '', attachments: [], checkClipboard: true });
        window.history.replaceState({}, '', '/');
        return;
    }

    if (hasShareTarget) {
        try {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('saveitforl8r-share', 1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (!db.objectStoreNames.contains('shares')) return;

            const tx = db.transaction('shares', 'readwrite');
            const store = tx.objectStore('shares');
            const getAllReq = store.getAll();

            getAllReq.onsuccess = async () => {
                const shares = getAllReq.result;
                if (shares && shares.length > 0) {
                    const latestShare = shares[shares.length - 1];
                    let text = latestShare.text || '';
                    if (latestShare.title) text = `${latestShare.title}\n${text}`;
                    if (latestShare.url) text = `${text}\n${latestShare.url}`;

                    const attachments: Attachment[] = [];
                    if (latestShare.files) {
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
        } catch (e) {
            console.error("[ShareReceiver] IDB Error:", e);
        }
    }
  }, []);

  useEffect(() => {
    if (isNative()) {
        // Native Loop: Check immediately, then retry a few times
        // The Intent might take a moment to be readable by the plugin
        let attempts = 0;
        const check = async () => {
            const found = await checkNativeIntent();
            if (found) return; // Stop if found

            attempts++;
            if (attempts < 5) {
                setTimeout(check, 500);
            }
        };
        check();

        // Also check on resume (app comes back from background)
        const handleResume = () => {
            attempts = 0;
            check();
        };
        document.addEventListener('resume', handleResume); // Cordova/Capacitor event

        // Listen for sendIntentReceived event - dispatched by MainActivity.onNewIntent()
        // This handles the case when the app is already running and receives a share intent
        const handleSendIntentReceived = () => {
            console.log('[ShareReceiver] sendIntentReceived event fired');
            // Reset attempts and check immediately
            attempts = 0;
            check();
        };
        window.addEventListener('sendIntentReceived', handleSendIntentReceived);

        return () => {
            document.removeEventListener('resume', handleResume);
            window.removeEventListener('sendIntentReceived', handleSendIntentReceived);
        };
    } else {
        checkForWebShare();
    }
  }, [checkForWebShare, checkNativeIntent]);

  return { shareData, clearShareData: () => setShareData(null) };
};
