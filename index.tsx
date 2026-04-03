import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { SplashScreen } from '@capacitor/splash-screen';

// Signal to Android native code that the WebView has rendered content,
// dismissing the native splash screen as early as possible. This runs
// synchronously after React's first commit, before effects settle.
declare global {
  interface Window {
    AndroidBridge?: {
      signalAppReady: () => void;
      enableRemoteMode: () => void;
      disableRemoteMode: () => void;
      openNotificationSettings: () => void;
      startForegroundSync: (totalItems: number) => void;
      updateSyncProgress: (current: number, total: number) => void;
      stopForegroundSync: () => void;
      embeddingModelStatus: (requestId: number) => void;
      embeddingDownloadModel: (requestId: number) => void;
      embeddingGenerate: (requestId: number, text: string) => void;
      embeddingGenerateBatch: (requestId: number, textsJson: string) => void;
    };
    webkit?: {
      messageHandlers: {
        IOSBridge: {
          postMessage: (message: { action: string; [key: string]: unknown }) => void;
        };
      };
    };
    __shareReceiverReady?: boolean;
    __pendingShareData?: { text?: string; attachments?: Array<{ name: string; mimeType: string; path: string; dataUrl?: string }> };
    __pendingWidgetEvent?: { mode?: string };
    __pendingWidgetSearch?: boolean;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Dismiss native splash screen after React has been scheduled to render.
// IMPORTANT: Use setTimeout instead of requestAnimationFrame — iOS WKWebView
// throttles/suspends rAF callbacks when the view is obscured by the native
// Capacitor splash overlay, creating a deadlock where the splash can never
// be hidden. setTimeout(0) defers to the next task-queue turn which fires
// regardless of view visibility.
setTimeout(() => {
  try { window.AndroidBridge?.signalAppReady(); }
  catch (e) { console.warn('[Splash] Failed to signal app ready:', e); }

  SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => { /* not on native */ });
}, 0);

// Safety net: if the splash still hasn't been hidden after 4 seconds
// (e.g. the first setTimeout was somehow blocked), force-hide it.
setTimeout(() => {
  SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {});
}, 4000);
