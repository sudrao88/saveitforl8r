import { useState, useEffect, useCallback, useRef } from 'react';
import { Attachment } from '../types';
import { isNative } from '../services/platform';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

export interface ShareData {
  text: string;
  attachments: Attachment[];
  checkClipboard?: boolean;
}

// AndroidBridge global type is declared in index.tsx

interface NativeShareData {
  text?: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    path: string;
  }>;
}

// Maximum blob size for shared images (50MB)
const MAX_BLOB_SIZE = 50 * 1024 * 1024;

/**
 * Signal to Android native code that the React app is ready to receive share intents.
 */
const signalAppReady = () => {
  try {
    if (isNative() && window.AndroidBridge?.signalAppReady) {
      console.log('[ShareReceiver] Signaling app ready to Android');
      window.AndroidBridge.signalAppReady();
    }
  } catch (e) {
    console.warn('[ShareReceiver] Failed to signal app ready:', e);
  }
};

export const useShareReceiver = () => {
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const hasSignaledReady = useRef(false);

  // Native Share Handler
  const handleNativeShare = useCallback(async (event: any) => {
    console.log('[ShareReceiver] Received native share event:', event);
    
    // The data might be in event.detail (if CustomEvent) or just the event object itself depending on how Capacitor triggers it
    const data: NativeShareData = event.detail || event;
    
    if (!data) {
        console.warn('[ShareReceiver] Received empty share event');
        return;
    }

    const text = data.text || '';
    const rawAttachments = data.attachments || [];
    const processedAttachments: Attachment[] = [];

    console.log(`[ShareReceiver] Processing ${rawAttachments.length} attachments`);

    for (const att of rawAttachments) {
        try {
            // Convert the file path to a web-accessible URL
            // Android: file:///... paths, iOS: absolute paths from app group container
            const filePath = att.path.startsWith('file://') ? att.path : `file://${att.path}`;
            const webPath = Capacitor.convertFileSrc(filePath);
            console.log('[ShareReceiver] Reading attachment from:', webPath);

            const response = await fetch(webPath);
            const blob = await response.blob();
            
            if (blob.size > MAX_BLOB_SIZE) {
                console.warn('[ShareReceiver] File too large, skipping:', blob.size);
                continue;
            }

            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onload = e => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('FileReader error'));
                reader.readAsDataURL(blob);
            });

            processedAttachments.push({
                id: crypto.randomUUID(),
                type: att.mimeType.startsWith('image/') ? 'image' : 'file',
                mimeType: att.mimeType,
                data: base64,
                name: att.name || 'Shared File'
            });

        } catch (e) {
            console.error('[ShareReceiver] Failed to process attachment:', att.path, e);
        }
    }

    if (text || processedAttachments.length > 0) {
        console.log('[ShareReceiver] Setting share data');
        setShareData({ text: text.trim(), attachments: processedAttachments });
    }
  }, []);


  // Web Logic
  const checkForWebShare = useCallback(async () => {
    if (isNative()) return; 

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

  const clearShareData = useCallback(() => {
      setShareData(null);
  }, []);

  useEffect(() => {
    if (isNative()) {
        console.log('[ShareReceiver] Setting up native listener');

        // Listen for the custom event dispatched by native code
        window.addEventListener('onShareReceived', handleNativeShare);

        // Signal to iOS native code that the JS listener is ready.
        // If share data arrived before the listener was set up,
        // it will be stored on window.__pendingShareData — dispatch it now.
        (window as any).__shareReceiverReady = true;
        const pendingData = (window as any).__pendingShareData;
        if (pendingData) {
            console.log('[ShareReceiver] Found pending share data from native');
            delete (window as any).__pendingShareData;
            window.dispatchEvent(new CustomEvent('onShareReceived', { detail: pendingData }));
        }

        if (!hasSignaledReady.current) {
            hasSignaledReady.current = true;
            signalAppReady();
        }

        return () => {
            window.removeEventListener('onShareReceived', handleNativeShare);
            (window as any).__shareReceiverReady = false;
        };
    } else {
        checkForWebShare();
    }
  }, [handleNativeShare, checkForWebShare]);

  return { shareData, clearShareData };
};
