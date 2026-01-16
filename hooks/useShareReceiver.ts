import { useState, useEffect } from 'react';
import { Attachment } from '../types';

interface ShareData {
  text: string;
  attachments: Attachment[];
}

export const useShareReceiver = () => {
  const [shareData, setShareData] = useState<ShareData | null>(null);

  useEffect(() => {
    const checkForShare = async () => {
      // Check query param first
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has('share-target')) return;

      // Access IDB
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
             return; // No store, nothing to do
        }

        // Get transactions
        const tx = db.transaction('shares', 'readwrite');
        const store = tx.objectStore('shares');
        const getAllReq = store.getAll();

        getAllReq.onsuccess = async () => {
            const shares = getAllReq.result;
            if (shares && shares.length > 0) {
                // We'll take the last share (most recent)
                const latestShare = shares[shares.length - 1];
                
                // Process Share Content
                let text = latestShare.text || '';
                const title = latestShare.title || '';
                const url = latestShare.url || '';
                
                if (title) text = `${title}\n${text}`;
                if (url) text = `${text}\n${url}`;

                // Process Attachments (Files/Blobs)
                const attachments: Attachment[] = [];
                if (latestShare.files && latestShare.files.length > 0) {
                    for (const f of latestShare.files) {
                         const blob = f.blob || f; // Depending on how it was stored
                         
                         // Check if blob is valid
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

                // Clean up IDB
                const clearTx = db.transaction('shares', 'readwrite');
                clearTx.objectStore('shares').clear();
            }
        };

        // Clean URL
        window.history.replaceState({}, '', '/');
      } catch (e) {
        console.error("Error retrieving share data:", e);
      }
    };

    checkForShare();
  }, []);

  return { shareData, clearShareData: () => setShareData(null) };
};
