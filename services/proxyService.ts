/**
 * proxyService.ts
 *
 * HTTP client for the SaveItForL8R server proxy.
 * Replaces direct Gemini API calls — the server owns the API key
 * and decides which model to use.
 *
 * SECURITY: Every request includes the user's Google OAuth access token
 * so the server can authenticate the caller and rate limit per account.
 */

import { getStoredToken } from './tokenService';

const getProxyUrl = (): string => {
  const url = import.meta.env.VITE_PROXY_URL;
  if (!url) {
    throw new Error('VITE_PROXY_URL is not configured. Set it in your .env file.');
  }
  // Strip trailing slash for consistent joining
  return url.replace(/\/+$/, '');
};

/**
 * Retrieve the current Google OAuth access token.
 * Returns null if the user is not authenticated.
 */
const getAccessToken = async (): Promise<string | null> => {
  try {
    const token = await getStoredToken('access_token');
    return token || null;
  } catch {
    return null;
  }
};

interface ProxyRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * POST to a proxy endpoint and return the parsed JSON response.
 * Throws on network errors or non-2xx status codes.
 *
 * Automatically attaches the user's Google OAuth Bearer token for
 * server-side authentication and rate limiting.
 */
const postProxy = async <T>(path: string, body: unknown, options?: ProxyRequestOptions): Promise<T> => {
  const url = `${getProxyUrl()}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Attach auth token if available
  const accessToken = await getAccessToken();
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Set up timeout
  const timeout = options?.timeout || 30000; // Default 30s timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal || controller.signal,
    });

    clearTimeout(id);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'Unknown error');
      throw new Error(`Proxy error ${res.status}: ${errorBody}`);
    }

    return res.json() as Promise<T>;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  }
};

export { getProxyUrl, postProxy };
