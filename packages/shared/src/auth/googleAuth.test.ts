import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock tokenService before importing googleAuth
vi.mock('./tokenService', () => ({
  storeTokens: vi.fn().mockResolvedValue(undefined),
  getStoredToken: vi.fn(),
  clearTokens: vi.fn().mockResolvedValue(undefined),
  setStorageNamespace: vi.fn(),
  migrateLegacyTokenStorage: vi.fn().mockResolvedValue(undefined),
}));

// Mock pkce
vi.mock('./pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('mock_verifier_123'),
  generateCodeChallenge: vi.fn().mockResolvedValue('mock_challenge_456'),
}));

import { configureGoogleAuth, handleAuthCallback, getAuthorizedFetch, getValidToken } from './googleAuth';
import { storeTokens, getStoredToken, clearTokens } from './tokenService';

// M1: OAuth config is now parametrized. Configure with saveitforl8r-like values
// (including the `saveitforl8r` storage namespace) before each test so the
// gdrive_linked / pkce_verifier keys are written under that namespace.
const NS = 'saveitforl8r';
const configure = () =>
  configureGoogleAuth({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scopes: ['https://www.googleapis.com/auth/drive.appdata'],
    hostedUrl: 'https://saveitforl8r.com',
    deepLinkScheme: 'com.saveitforl8r.app',
    storageNamespace: NS,
    proxyUrl: 'https://proxy.example.com',
  });

describe('googleAuth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    localStorage.clear();
    sessionStorage.clear();
    configure();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('handleAuthCallback', () => {
    it('should do nothing if no code in URL', async () => {
      Object.defineProperty(window, 'location', {
        value: { search: '', pathname: '/', origin: 'http://localhost' },
        writable: true,
      });

      await handleAuthCallback();
      expect(storeTokens).not.toHaveBeenCalled();
    });

    it('should throw if auth error in URL params', async () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?error=access_denied', pathname: '/', origin: 'http://localhost' },
        writable: true,
      });

      await expect(handleAuthCallback()).rejects.toThrow('Auth failed: access_denied');
    });

    it('should exchange code for tokens on valid callback', async () => {
      localStorage.setItem('saveitforl8r:pkce_verifier', 'mock_verifier');

      Object.defineProperty(window, 'location', {
        value: {
          search: '?code=auth_code_123',
          pathname: '/',
          origin: 'http://localhost',
        },
        writable: true,
      });

      window.history.replaceState = vi.fn();

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: 'new_refresh_token',
        }),
      });

      await handleAuthCallback();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(storeTokens).toHaveBeenCalledWith(
        'new_access_token',
        expect.any(Number),
        'new_refresh_token'
      );
      expect(localStorage.getItem('saveitforl8r:gdrive_linked')).toBe('true');
    });

    it('should throw on token exchange failure', async () => {
      localStorage.setItem('saveitforl8r:pkce_verifier', 'mock_verifier');

      Object.defineProperty(window, 'location', {
        value: {
          search: '?code=bad_code',
          pathname: '/',
          origin: 'http://localhost',
        },
        writable: true,
      });

      window.history.replaceState = vi.fn();

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'invalid_grant',
      });

      await expect(handleAuthCallback()).rejects.toThrow('Token exchange failed');
    });
  });

  describe('getAuthorizedFetch', () => {
    it('should use existing valid token for requests', async () => {
      const futureExpiry = Date.now() + 300000;
      (getStoredToken as any)
        .mockResolvedValueOnce('valid_token')
        .mockResolvedValueOnce(futureExpiry);

      const mockResponse = { ok: true, status: 200 };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await getAuthorizedFetch('https://api.example.com/data');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid_token',
          }),
        })
      );
      expect(result).toBe(mockResponse);
    });

    it('should refresh token when expired', async () => {
      const pastExpiry = Date.now() - 10000;
      (getStoredToken as any)
        .mockResolvedValueOnce('expired_token')
        .mockResolvedValueOnce(pastExpiry)
        .mockResolvedValueOnce('stored_refresh');

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'refreshed_token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      await getAuthorizedFetch('https://api.example.com/data');

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer refreshed_token',
          }),
        })
      );
    });

    it('should clear tokens on 401 refresh failure', async () => {
      (getStoredToken as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('old_refresh');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(
        getAuthorizedFetch('https://api.example.com/data')
      ).rejects.toThrow('Token refresh failed');

      expect(clearTokens).toHaveBeenCalled();
      expect(localStorage.getItem('saveitforl8r:gdrive_linked')).toBeNull();
    });
  });

  describe('getValidToken', () => {
    it('should return existing token when not expired', async () => {
      const futureExpiry = Date.now() + 300000;
      (getStoredToken as any)
        .mockResolvedValueOnce('my_token')
        .mockResolvedValueOnce(futureExpiry);

      const token = await getValidToken();
      expect(token).toBe('my_token');
    });

    it('should refresh and return new token when expired', async () => {
      const pastExpiry = Date.now() - 10000;
      (getStoredToken as any)
        .mockResolvedValueOnce('old_token')
        .mockResolvedValueOnce(pastExpiry)
        .mockResolvedValueOnce('refresh_token_val');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh_token',
          expires_in: 3600,
        }),
      });

      const token = await getValidToken();
      expect(token).toBe('fresh_token');
    });
  });
});
