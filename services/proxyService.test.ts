import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValidToken = vi.fn();

vi.mock('./googleAuth', () => ({
  getValidToken: (...args: unknown[]) => getValidToken(...args),
}));

describe('proxyService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a valid proxy URL is configured.
    import.meta.env.VITE_PROXY_URL = 'https://proxy.example.com';
    getValidToken.mockResolvedValue('fake-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('getProxyUrl strips trailing slashes', async () => {
    import.meta.env.VITE_PROXY_URL = 'https://proxy.example.com///';
    const { getProxyUrl } = await import('./proxyService');
    expect(getProxyUrl()).toBe('https://proxy.example.com');
  });

  it('getProxyUrl throws when VITE_PROXY_URL is missing', async () => {
    import.meta.env.VITE_PROXY_URL = '';
    const { getProxyUrl } = await import('./proxyService');
    expect(() => getProxyUrl()).toThrow(/VITE_PROXY_URL is not configured/);
  });

  it('postProxy sends POST with JSON body and auth header', async () => {
    const { postProxy } = await import('./proxyService');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as any;

    const result = await postProxy<{ ok: boolean }>('/api/enrich', { text: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proxy.example.com/api/enrich');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'hello' }));
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe('Bearer fake-token');
  });

  it('postProxy omits Authorization when no token is available', async () => {
    getValidToken.mockResolvedValueOnce(null);
    const { postProxy } = await import('./proxyService');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await postProxy('/api/ping', {});

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('postProxy treats a thrown getValidToken as anonymous', async () => {
    getValidToken.mockRejectedValueOnce(new Error('refresh failed'));
    const { postProxy } = await import('./proxyService');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await postProxy('/api/ping', {});
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('postProxy throws with the proxy error status and body on non-2xx', async () => {
    const { postProxy } = await import('./proxyService');
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Too many requests', { status: 429 }),
    ) as any;

    await expect(postProxy('/api/enrich', {})).rejects.toThrow(
      /Proxy error 429: Too many requests/,
    );
  });

  it('postProxy surfaces network errors verbatim', async () => {
    const { postProxy } = await import('./proxyService');
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network down')) as any;

    await expect(postProxy('/api/enrich', {})).rejects.toThrow('network down');
  });

  it('postProxy converts AbortError into a "Request timed out" error', async () => {
    const { postProxy } = await import('./proxyService');
    const err = new Error('aborted');
    err.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(err) as any;

    await expect(postProxy('/api/enrich', {})).rejects.toThrow('Request timed out');
  });

  it('postProxy handles proxy URLs without a trailing slash', async () => {
    import.meta.env.VITE_PROXY_URL = 'https://proxy.example.com';
    const { postProxy } = await import('./proxyService');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    await postProxy('/api/query', {});
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/api/query');
  });

  it('postProxy respects a caller-provided AbortSignal', async () => {
    const { postProxy } = await import('./proxyService');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    const controller = new AbortController();
    await postProxy('/api/ping', {}, { signal: controller.signal });
    const [, init] = fetchMock.mock.calls[0];
    // When callers pass a signal, it should flow through to fetch.
    expect(init.signal).toBe(controller.signal);
  });
});
