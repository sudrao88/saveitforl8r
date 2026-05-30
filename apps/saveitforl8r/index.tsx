import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { SplashScreen } from '@capacitor/splash-screen';
import { configureGoogleAuth } from '@l8r/shared/auth';

// Configure shared Google OAuth with saveitforl8r's values (M1). The hosted
// bouncer URL falls back to the known production URL because VITE_APP_URL is
// absent after OTA updates (web builds don't include it). Namespacing token/IDB
// storage under `saveitforl8r` isolates it from l8rgram on a shared origin and
// triggers a one-time migration of the legacy unprefixed keys.
configureGoogleAuth({
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  clientSecret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
  hostedUrl: import.meta.env.VITE_APP_URL || 'https://saveitforl8r.com',
  deepLinkScheme: 'com.saveitforl8r.app',
  storageNamespace: 'saveitforl8r',
  proxyUrl: import.meta.env.VITE_PROXY_URL,
});

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
