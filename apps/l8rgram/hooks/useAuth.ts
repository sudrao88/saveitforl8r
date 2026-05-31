import { useState, useCallback, useEffect } from 'react';
import {
  initiateLogin,
  handleAuthCallback,
  handleDeepLink,
  getStoredToken,
  clearTokens,
} from '@l8r/shared/auth';
import { isNative, storage } from '@l8r/shared/platform';
import { App } from '@capacitor/app';

export type AuthStatus = 'unlinked' | 'linked' | 'authenticating' | 'error';

// The shared googleAuth module sets this namespaced flag after a successful
// token exchange (the key name is historical — it just means "Google linked").
const LINKED_FLAG_KEY = 'l8rgram:gdrive_linked';

/**
 * Thin wrapper around @l8r/shared/auth for l8rgram. OAuth is configured once in
 * index.tsx (calendar.readonly scope, l8rgram client id + storage namespace);
 * this hook drives the login UI state and bridges the web callback / native
 * deep-link return paths.
 */
export const useAuth = () => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unlinked');
  const [authError, setAuthError] = useState<string | null>(null);

  const isLinked = useCallback(async (): Promise<boolean> => {
    // A refresh token is the durable signal that the user has linked Google.
    const refresh = await getStoredToken('refresh_token');
    return !!refresh;
  }, []);

  // Initial status from persisted tokens.
  useEffect(() => {
    isLinked().then((linked) => setAuthStatus(linked ? 'linked' : 'unlinked'));
  }, [isLinked]);

  const login = useCallback(async () => {
    try {
      setAuthStatus('authenticating');
      setAuthError(null);
      await initiateLogin();
      // Web: a redirect happens now; status resolves on return (effect below).
      // Native: the system browser opens; the deep-link listener resolves it.
    } catch (e) {
      console.error('[l8rgram] Login failed', e);
      setAuthStatus('error');
      setAuthError('Failed to start Google sign-in.');
    }
  }, []);

  const logout = useCallback(async () => {
    await clearTokens();
    await storage.remove(LINKED_FLAG_KEY);
    setAuthStatus('unlinked');
  }, []);

  // Web OAuth callback (?code=...) — exchange and reflect the result.
  useEffect(() => {
    if (isNative()) return;
    if (!window.location.search.includes('code=')) return;
    setAuthStatus('authenticating');
    handleAuthCallback()
      .then(async () => {
        setAuthStatus((await isLinked()) ? 'linked' : 'unlinked');
      })
      .catch((e) => {
        console.error('[l8rgram] Auth callback failed', e);
        setAuthStatus('error');
        setAuthError('Authentication failed. Please try again.');
      });
  }, [isLinked]);

  // Native deep-link return (l8rgram://google-auth?code=...).
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.includes('code=')) return;
      setAuthStatus('authenticating');
      const ok = await handleDeepLink(url);
      setAuthStatus(ok ? 'linked' : 'error');
      if (!ok) setAuthError('Authentication failed. Please try again.');
    }).then((handle) => {
      remove = () => handle.remove();
    });
    return () => remove?.();
  }, []);

  return { authStatus, authError, login, logout };
};
