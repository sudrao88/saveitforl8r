// auth/googleAuth.ts
import { generateCodeVerifier, generateCodeChallenge } from './pkce';
import {
  storeTokens,
  getStoredToken,
  clearTokens,
  setStorageNamespace,
  migrateLegacyTokenStorage,
} from './tokenService';
import { storage, isNative } from '../platform/platform';
import { Browser } from '@capacitor/browser';

// --- Configuration -----------------------------------------------------------
// M1: OAuth config is no longer hardcoded. Each app calls configureGoogleAuth()
// once at startup with its own client id/secret, scopes, hosted bouncer URL,
// deep-link scheme, and storage namespace. saveitforl8r passes its existing
// values (drive.appdata scope, `saveitforl8r` namespace); l8rgram passes its own.
export interface GoogleAuthConfig {
  clientId: string;
  // SECURITY NOTE (Accepted Risk): The client secret is embedded in the JS bundle at build time.
  // For Google OAuth "Web application" client type, the secret is treated as non-confidential.
  // The PKCE flow protects against authorization code interception. The secret alone cannot be
  // used to impersonate users without a valid auth code + verifier. A future BFF refactor
  // could move token exchange to the server proxy to eliminate this exposure entirely.
  clientSecret: string;
  scopes: string[];
  // The hosted PWA URL is required for Native Auth redirection (Bouncer pattern)
  // because Google only accepts http/https redirect URIs for Web Clients.
  // In native context, window.location.origin is https://localhost (Capacitor),
  // which is NOT a valid Google OAuth redirect URI.
  hostedUrl: string;
  deepLinkScheme: string;
  storageNamespace?: string;
  proxyUrl: string;
}

let config: GoogleAuthConfig | null = null;
let migrationPromise: Promise<void> = Promise.resolve();

export function configureGoogleAuth(cfg: GoogleAuthConfig): void {
  config = cfg;
  setStorageNamespace(cfg.storageNamespace);
  // Kick off the one-time legacy-storage migration. Token-reading entry points
  // await this promise so a logged-in user's keys are migrated before first use.
  migrationPromise = migrateLegacyTokenStorage(cfg.storageNamespace).catch((e) => {
    console.error('[Auth] Token storage migration failed', e);
  });

  if (!cfg.clientId) {
    console.warn('[Auth] clientId is not set. Google sync will not work.');
  }
  if (!cfg.clientSecret) {
    console.warn('[Auth] clientSecret is not set. Google sync will not work.');
  }
}

export function getGoogleAuthConfig(): GoogleAuthConfig {
  if (!config) {
    throw new Error(
      'Google Auth is not configured. Call configureGoogleAuth() at startup before using auth.',
    );
  }
  return config;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

// Namespace the storage-adapter keys this module owns (verifier + linked flag)
// so two apps on a shared origin don't collide.
const nsKey = (key: string): string => {
  const ns = config?.storageNamespace;
  return ns ? `${ns}:${key}` : key;
};

// Initiate Login Flow (PKCE)
export const initiateLogin = async () => {
  await migrationPromise;
  const cfg = getGoogleAuthConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    const missing = [!cfg.clientId && 'clientId', !cfg.clientSecret && 'clientSecret'].filter(Boolean).join(', ');
    throw new Error(`Google Drive configuration error: ${missing} not set. Check environment variables and Secret Manager.`);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Use persistent storage for verifier to survive app restarts/redirects
  await storage.set(nsKey('pkce_verifier'), codeVerifier);

  const isNativeApp = isNative();

  // For Native: Redirect to the hosted PWA (hostedUrl), which will then "bounce" back to the app via Custom Scheme
  // For Web: Redirect to current origin
  const REDIRECT_URI = isNativeApp ? cfg.hostedUrl : window.location.origin;

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
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

  const cfg = getGoogleAuthConfig();
  const verifier = await storage.get(nsKey('pkce_verifier'));
  if (!code || !verifier) {
      if (!code) console.log("No code found in callback");
      if (!verifier) console.error("No PKCE verifier found in storage");
      return;
  }

  // Clean up verifier
  await storage.remove(nsKey('pkce_verifier'));

  if (!cfg.clientId || !cfg.clientSecret) {
      const missing = [!cfg.clientId && 'Client ID', !cfg.clientSecret && 'Client Secret'].filter(Boolean).join(', ');
      console.error(`[Auth] Missing ${missing}. Google Web Flow requires both.`);
      throw new Error(`Configuration Error: Missing ${missing}`);
  }

  const isNativeApp = isNative();
  // We must use the SAME redirect_uri that was used in the initial request
  const REDIRECT_URI = isNativeApp ? cfg.hostedUrl : window.location.origin;

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
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
  await storage.set(nsKey('gdrive_linked'), 'true');

  return true; // Success
};

// Handle Web Callback
export const handleAuthCallback = async () => {
  await migrationPromise;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  // Clean URL on web
  if (code || error) {
      window.history.replaceState({}, document.title, window.location.pathname);
  }

  return exchangeCodeForToken(code, error);
};

// Handle Native Deep Link — returns true if auth succeeded
export const handleDeepLink = async (url: string): Promise<boolean> => {
    // URL format: <deepLinkScheme>://google-auth?code=...
    console.log("[Auth] Handling Deep Link:", url);
    await migrationPromise;

    // We can use the URL API, but we need to ensure the scheme is handled
    try {
        const urlObj = new URL(url);
        const params = new URLSearchParams(urlObj.search);
        const code = params.get('code');
        const error = params.get('error');

        const success = await exchangeCodeForToken(code, error);

        // Close the browser window if it's still open (sometimes needed on iOS, rarely on Android if redirect happened)
        await Browser.close();

        // Return success so the caller can update React state directly
        // instead of relying on window.location.reload() which is unreliable
        // on Android when called from a deep link handler.
        return !!success;
    } catch (e) {
        console.error("Deep link handling failed:", e);
        return false;
    }
};

// Refresh Access Token
const refreshAccessToken = async () => {
  const cfg = getGoogleAuthConfig();
  const refreshToken = await getStoredToken('refresh_token');
  if (!refreshToken) throw new Error('No refresh token available');

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
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
          await storage.remove(nsKey('gdrive_linked'));
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
  await migrationPromise;
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
    await migrationPromise;
    let token = await getStoredToken('access_token');
    const expiresAt = await getStoredToken('expires_at');

    if (!token || !expiresAt || Date.now() >= expiresAt - 60000) {
        token = await refreshAccessToken();
    }
    return token;
}
