// services/googleAuth.ts
import { generateCodeVerifier, generateCodeChallenge } from './pkce';
import { storeTokens, getStoredToken, clearTokens } from './tokenService';
import { storage, isNative } from './platform';
import { Browser } from '@capacitor/browser';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
// The hosted PWA URL is required for Native Auth redirection (Bouncer pattern)
// because Google only accepts http/https redirect URIs for Web Clients.
const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin;

if (!CLIENT_ID) {
  console.warn('[Auth] VITE_GOOGLE_CLIENT_ID is not set. Google Drive sync will not work.');
}

// Removed email and profile scopes as they are not needed for Refresh Token flow
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata'; 
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

// Initiate Login Flow (PKCE)
export const initiateLogin = async () => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Use persistent storage for verifier to survive app restarts/redirects
  await storage.set('pkce_verifier', codeVerifier);

  const isNativeApp = isNative();
  
  // For Native: Redirect to the hosted PWA (APP_URL), which will then "bounce" back to the app via Custom Scheme
  // For Web: Redirect to current origin
  const REDIRECT_URI = isNativeApp ? APP_URL : window.location.origin;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // Crucial for refresh token
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent', // Force consent to ensure refresh token is returned
    state: isNativeApp ? 'is_native_login' : 'web_login' // Flag to tell the PWA to bounce back to native
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;
  console.log('[Auth] Redirecting to:', authUrl);
  
  if (isNativeApp) {
      // Open system browser (not InAppBrowser) to share cookies/session if needed, 
      // but mainly to allow the redirect loop to happen correctly outside the WebView.
      await Browser.open({ url: authUrl, windowName: '_system' });
  } else {
      window.location.href = authUrl;
  }
};

// Core Logic: Exchange Code for Token
const exchangeCodeForToken = async (code: string | null, error: string | null) => {
  if (error) throw new Error(`Auth failed: ${error}`);
  
  const verifier = await storage.get('pkce_verifier');
  if (!code || !verifier) {
      if (!code) console.log("No code found in callback");
      if (!verifier) console.error("No PKCE verifier found in storage");
      return;
  }

  // Clean up verifier
  await storage.remove('pkce_verifier');

  if (!CLIENT_SECRET) {
      console.error("Missing Client Secret. Google Web Flow requires it.");
      throw new Error("Configuration Error: Missing Client Secret");
  }

  const isNativeApp = isNative();
  // We must use the SAME redirect_uri that was used in the initial request
  const REDIRECT_URI = isNativeApp ? APP_URL : window.location.origin;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
      const errText = await res.text();
      console.error('Token exchange failed:', errText);
      throw new Error('Token exchange failed: ' + errText);
  }

  const data = await res.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  
  await storeTokens(data.access_token, expiresAt, data.refresh_token);
  // Use storage adapter for cross-platform consistency
  await storage.set('gdrive_linked', 'true');
  
  return true; // Success
};

// Handle Web Callback
export const handleAuthCallback = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  // Clean URL on web
  if (code || error) {
      window.history.replaceState({}, document.title, window.location.pathname);
  }

  return exchangeCodeForToken(code, error);
};

// Handle Native Deep Link
export const handleDeepLink = async (url: string) => {
    // URL format: com.saveitforl8r.app://google-auth?code=...
    console.log("[Auth] Handling Deep Link:", url);
    
    // We can use the URL API, but we need to ensure the scheme is handled
    try {
        const urlObj = new URL(url);
        const params = new URLSearchParams(urlObj.search);
        const code = params.get('code');
        const error = params.get('error');
        
        await exchangeCodeForToken(code, error);
        
        // Close the browser window if it's still open (sometimes needed on iOS, rarely on Android if redirect happened)
        await Browser.close(); 
        
        // Force reload or state update might be needed in the app
        window.location.reload(); 
    } catch (e) {
        console.error("Deep link handling failed:", e);
    }
};

// Refresh Access Token
const refreshAccessToken = async () => {
  const refreshToken = await getStoredToken('refresh_token');
  if (!refreshToken) throw new Error('No refresh token available');

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
          await clearTokens();
          await storage.remove('gdrive_linked');
      }
      throw new Error('Token refresh failed');
  }

  const data = await res.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  
  // Update tokens (keep existing refresh token if not returned new one)
  await storeTokens(data.access_token, expiresAt, data.refresh_token || refreshToken);
  return data.access_token;
};

// Authorized Fetch Helper
export const getAuthorizedFetch = async (url: string, options: RequestInit = {}) => {
  let token = await getStoredToken('access_token');
  const expiresAt = await getStoredToken('expires_at');

  if (!token || !expiresAt || Date.now() >= expiresAt - 60000) {
    console.log('[Auth] Token expired or missing, refreshing...');
    try {
        token = await refreshAccessToken();
    } catch (e) {
        console.error("Failed to refresh token", e);
        throw e;
    }
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };

  return fetch(url, { ...options, headers });
};

export const getValidToken = async (): Promise<string> => {
    let token = await getStoredToken('access_token');
    const expiresAt = await getStoredToken('expires_at');

    if (!token || !expiresAt || Date.now() >= expiresAt - 60000) {
        token = await refreshAccessToken();
    }
    return token;
}
