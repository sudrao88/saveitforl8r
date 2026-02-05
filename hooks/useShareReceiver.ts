import { useState, useEffect, useCallback, useRef } from 'react';
import { SendIntent } from '@mindlib-capacitor/send-intent';
import { Attachment } from '../types';
import { isNative } from '../services/platform';

export interface ShareData {
  text: string;
  attachments: Attachment[];
  checkClipboard?: boolean;
}

// Declare the Android bridge interface
declare global {
  interface Window {
    AndroidBridge?: {
      signalAppReady: () => void;
    };
  }
}

/**
 * Signal to Android native code that the React app is ready to receive share intents.
 * This is crucial for proper cold-start handling of share intents.
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
  const hasProcessedIntent = useRef(false);
  const hasSignaledReady = useRef(false);

  // Native Intent Check (Async & Retryable)
  const checkNativeIntent = useCallback(async (): Promise<boolean> => {
      if (!isNative()) {
          console.log('[ShareReceiver] Not native platform, skipping');
          return false;
      }

      // Prevent processing the same intent multiple times
      if (hasProcessedIntent.current) {
          console.log('[ShareReceiver] Intent already processed, skipping');
          return true;
      }

      try {
         console.log('[ShareReceiver] Calling SendIntent.checkSendIntentReceived()...');

         // Add timeout to prevent hanging
         const timeoutPromise = new Promise<null>((_, reject) => {
             setTimeout(() => reject(new Error('SendIntent timeout')), 5000);
         });

         const response = await Promise.race([
             SendIntent.checkSendIntentReceived(),
             timeoutPromise
         ]);

         console.log('[ShareReceiver] Raw response:', JSON.stringify(response, null, 2));

         if (!response) {
             console.log('[ShareReceiver] No response from SendIntent plugin');
             return false;
         }

         // Check if response has any meaningful data
         const hasData = response.title || response.description || response.url || response.type;
         if (!hasData) {
             console.log('[ShareReceiver] Response has no meaningful data');
             return false;
         }

         console.log('[ShareReceiver] Processing intent data...');

         let text = response.title || response.description || '';
         if (response.url && !text.includes(response.url)) {
            text = text ? `${text}\n${response.url}` : response.url;
         }

         console.log('[ShareReceiver] Extracted text:', text);

         const attachments: Attachment[] = [];

         // Process image attachments with proper error handling
         if (response.type?.startsWith('image/') && response.url) {
             console.log('[ShareReceiver] Processing image attachment:', response.url);
             try {
                 // Create an AbortController for the fetch timeout
                 const controller = new AbortController();
                 const fetchTimeout = setTimeout(() => controller.abort(), 10000);

                 const fileRes = await fetch(response.url, { signal: controller.signal });
                 clearTimeout(fetchTimeout);

                 if (!fileRes.ok) {
                     throw new Error(`Fetch failed with status ${fileRes.status}`);
                 }

                 const blob = await fileRes.blob();
                 console.log('[ShareReceiver] Fetched blob, size:', blob.size, 'type:', blob.type);

                 // Validate blob size to prevent memory issues
                 const MAX_BLOB_SIZE = 50 * 1024 * 1024; // 50MB limit
                 if (blob.size > MAX_BLOB_SIZE) {
                     console.warn('[ShareReceiver] Image too large, skipping:', blob.size);
                 } else if (blob.size > 0) {
                     const reader = new FileReader();
                     const base64 = await new Promise<string>((resolve, reject) => {
                         reader.onload = e => resolve(e.target?.result as string);
                         reader.onerror = () => reject(new Error('FileReader error'));
                         reader.readAsDataURL(blob);
                     });

                     attachments.push({
                         id: crypto.randomUUID(),
                         type: 'image',
                         mimeType: response.type || blob.type,
                         data: base64,
                         name: 'Shared Image'
                     });
                     console.log('[ShareReceiver] Image attachment processed successfully');
                 }
             } catch (e) {
                 console.error('[ShareReceiver] Failed to read native attachment:', e);
                 // Don't let image processing failure prevent text from being shared
             }
         }

         if (text || attachments.length > 0) {
            console.log('[ShareReceiver] Setting share data - text length:', text.length, 'attachments:', attachments.length);
            hasProcessedIntent.current = true;
            setShareData({ text: text.trim(), attachments });

            // Call finish() to clear the intent so it doesn't get processed again
            try {
                await SendIntent.finish();
                console.log('[ShareReceiver] SendIntent.finish() called');
            } catch (e) {
                // finish() failure is non-critical
                console.warn('[ShareReceiver] SendIntent.finish() failed:', e);
            }

            return true;
         } else {
            console.log('[ShareReceiver] No text or attachments to share');
         }
      } catch (e) {
         // Catch all errors to prevent app crash
         console.error('[ShareReceiver] SendIntent plugin error:', e);
         // Log additional error details if available
         if (e instanceof Error) {
             console.error('[ShareReceiver] Error name:', e.name, 'message:', e.message);
         }
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

  // Reset the processed flag when clearing share data
  const clearShareData = useCallback(() => {
      console.log('[ShareReceiver] Clearing share data and resetting processed flag');
      hasProcessedIntent.current = false;
      setShareData(null);
  }, []);

  useEffect(() => {
    if (isNative()) {
        console.log('[ShareReceiver] Initializing native share receiver');

        // Check function with retry logic
        let attempts = 0;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let isActive = true;

        const check = async (reason: string) => {
            if (!isActive) return;

            console.log(`[ShareReceiver] Checking intent (${reason}), attempt ${attempts + 1}`);
            try {
                const found = await checkNativeIntent();

                if (found) {
                    console.log('[ShareReceiver] Intent found and processed!');
                    return;
                }
            } catch (e) {
                console.error('[ShareReceiver] Error during intent check:', e);
            }

            attempts++;
            // Increase retry attempts and interval for cold start reliability
            if (attempts < 8 && isActive) {
                // Progressive delay: 300ms, 500ms, 700ms, 1000ms, 1500ms, 2000ms, 2500ms
                const delay = Math.min(300 + (attempts * 200), 2500);
                console.log(`[ShareReceiver] Will retry in ${delay}ms`);
                timeoutId = setTimeout(() => check('retry'), delay);
            } else {
                console.log('[ShareReceiver] Max attempts reached, stopping checks');
            }
        };

        // Signal app readiness to Android - this is crucial for cold-start share intents
        // We do this once the React app has mounted and is ready to receive events
        if (!hasSignaledReady.current) {
            hasSignaledReady.current = true;
            // Small delay to ensure React state is fully initialized
            setTimeout(() => {
                signalAppReady();
            }, 100);
        }

        // Don't check immediately on mount - wait for the sendIntentReceived event
        // This is dispatched by MainActivity after the bridge is ready
        // However, we do one initial check after a delay for edge cases
        timeoutId = setTimeout(() => {
            console.log('[ShareReceiver] Initial delayed check');
            check('initial');
        }, 500);

        // Listen for sendIntentReceived event - dispatched by MainActivity
        // This handles both cold start (after delay) and warm start scenarios
        const handleSendIntentReceived = () => {
            console.log('[ShareReceiver] sendIntentReceived event received from native');
            // Reset state for new share
            hasProcessedIntent.current = false;
            attempts = 0;
            // Clear any pending timeout
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            // Small delay to ensure the intent data is available
            setTimeout(() => {
                check('sendIntentReceived event');
            }, 50);
        };
        window.addEventListener('sendIntentReceived', handleSendIntentReceived);

        // Also check on resume (app comes back from background without new intent)
        const handleResume = () => {
            console.log('[ShareReceiver] App resumed');
            // Only reset if we haven't already processed an intent
            if (!hasProcessedIntent.current) {
                attempts = 0;
                check('resume');
            }
        };
        document.addEventListener('resume', handleResume);

        return () => {
            console.log('[ShareReceiver] Cleaning up native listeners');
            isActive = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            document.removeEventListener('resume', handleResume);
            window.removeEventListener('sendIntentReceived', handleSendIntentReceived);
        };
    } else {
        checkForWebShare();
    }
  }, [checkForWebShare, checkNativeIntent]);

  return { shareData, clearShareData };
};
