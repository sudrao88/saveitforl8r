// services/googleAuth.ts
import { generateCodeVerifier, generateCodeChallenge } from './pkce';
import { storeTokens, getStoredToken, clearTokens } from './tokenService';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '267358862238-5lur0dimfrek6ep3uv8dlj48q7dlh40l.apps.googleusercontent.com';
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET; // Must be set in .env
const REDIRECT_URI = window.location.origin; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata email profile';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

// Initiate Login Flow (PKCE)
export const initiateLogin = async () => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem('pkce_verifier', codeVerifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // Crucial for refresh token
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent' // Force consent to ensure refresh token is returned
  });

  console.log('[Auth] Redirecting to:', `${AUTH_ENDPOINT}?${params.toString()}`);
  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
};

// Handle Callback
export const handleAuthCallback = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const verifier = sessionStorage.getItem('pkce_verifier');

  if (error) throw new Error(`Auth failed: ${error}`);
  if (!code || !verifier) return;

  window.history.replaceState({}, document.title, window.location.pathname);
  sessionStorage.removeItem('pkce_verifier');

  if (!CLIENT_SECRET) {
      console.error("Missing Client Secret. Google Web Flow requires it.");
      throw new Error("Configuration Error: Missing Client Secret");
  }

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
  localStorage.setItem('gdrive_linked', 'true');
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
          localStorage.removeItem('gdrive_linked');
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
