import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { configureGoogleAuth } from '@l8r/shared/auth';

// l8rgram's OAuth wiring (M2b). Calendar scope is the only sensitive permission;
// `storageNamespace: 'l8rgram'` keeps tokens/IDB cleanly partitioned from
// saveitforl8r if both PWAs ever share an origin in dev.
configureGoogleAuth({
  clientId: import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_ID,
  clientSecret: import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_SECRET,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  hostedUrl: import.meta.env.VITE_L8RGRAM_HOSTED_URL || 'https://l8rgram.com',
  deepLinkScheme: 'l8rgram',
  storageNamespace: 'l8rgram',
  proxyUrl: import.meta.env.VITE_PROXY_URL,
});

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
