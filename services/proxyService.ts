/**
 * proxyService.ts
 *
 * HTTP client for the SaveItForL8r server proxy.
 * Replaces direct Gemini API calls — the server owns the API key
 * and decides which model to use.
 */

const getProxyUrl = (): string => {
  const url = import.meta.env.VITE_PROXY_URL;
  if (!url) {
    throw new Error('VITE_PROXY_URL is not configured. Set it in your .env file.');
  }
  // Strip trailing slash for consistent joining
  return url.replace(/\/+$/, '');
};

interface ProxyRequestOptions {
  signal?: AbortSignal;
}

/**
 * POST to a proxy endpoint and return the parsed JSON response.
 * Throws on network errors or non-2xx status codes.
 */
const postProxy = async <T>(path: string, body: unknown, options?: ProxyRequestOptions): Promise<T> => {
  const url = `${getProxyUrl()}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'Unknown error');
    throw new Error(`Proxy error ${res.status}: ${errorBody}`);
  }

  return res.json() as Promise<T>;
};

export { getProxyUrl, postProxy };
