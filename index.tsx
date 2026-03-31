import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

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
    };
    webkit?: {
      messageHandlers: {
        IOSBridge: {
          postMessage: (message: { action: string }) => void;
        };
      };
    };
    __shareReceiverReady?: boolean;
    __pendingShareData?: { text?: string; attachments?: Array<{ name: string; mimeType: string; path: string }> };
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

// Dismiss native splash screen immediately after React mounts.
// requestAnimationFrame ensures the first paint has been committed.
requestAnimationFrame(() => {
  try {
    window.AndroidBridge?.signalAppReady();
  } catch (e) { console.warn('[Splash] Failed to signal app ready:', e); }
});
