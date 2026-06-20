import { useState, useCallback, useEffect } from 'react';
import { 
    initializeGoogleAuth, 
    loginToDrive, 
    isLinked as checkIsLinked, 
    unlinkDrive,
    getAccessToken,
    processAuthCallback
} from '../services/googleDriveService';
import { setUserId, clearUserId, trackLogin } from '../services/analytics';
import { isNative, storage } from '../services/platform';
import { sha256Hash } from '../utils/hash';

// Set the GA4 User-ID from the stored Google account `sub`. Hashing keeps the
// identifier pseudonymous in GA while remaining stable across devices, so the
// same person is counted once everywhere they sign in. Wrapped so analytics
// failures (e.g. crypto.subtle unavailable in a non-secure context) can never
// break the authentication flow.
const applyGaUserId = async () => {
  try {
    const sub = await storage.get('gdrive_user_id');
    if (sub) setUserId(await sha256Hash(sub));
  } catch (e) {
    console.warn('[Auth] Failed to set GA User-ID:', e);
  }
};

export type AuthStatus = 'unlinked' | 'linked' | 'authenticating' | 'error';

export const useAuth = () => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unlinked');
  const [authError, setAuthError] = useState<string | null>(null);

  // Initialize auth status (async for native storage)
  useEffect(() => {
    const initStatus = async () => {
        const linked = await checkIsLinked();
        setAuthStatus(linked ? 'linked' : 'unlinked');
        // Restore GA cross-device User-ID if already linked
        if (linked) await applyGaUserId();
    };
    initStatus();
  }, []);

  const handleLogin = useCallback(async () => {
    try {
        setAuthStatus('authenticating');
        setAuthError(null);
        await loginToDrive();
        // Note: The actual state change happens after redirect in the effect below or on reload
    } catch (error) {
        console.error('Login failed:', error);
        setAuthStatus('error');
        setAuthError('Failed to initiate login');
    }
  }, []);

  const handleUnlink = useCallback(async () => {
    await unlinkDrive();
    setAuthStatus('unlinked');
    clearUserId();
  }, []);

  // Re-check auth status from storage (used after native deep link auth)
  const recheckAuth = useCallback(async () => {
    const linked = await checkIsLinked();
    if (linked) {
        setAuthStatus('linked');
        await applyGaUserId();
        trackLogin();
    }
  }, []);

  // Handle OAuth Callback
  useEffect(() => {
    const handleAuth = async () => {
        // Only run this logic on Web. Native auth flow is handled differently (in-app browser or deeplink)
        // For now, assuming web-based redirect flow is used or native bridge handles it.
        // If native requires App Links, we'd listen for appUrlOpen here.
        if (!isNative() && window.location.search.includes('code=')) {
            
            // CRITICAL FIX: Check if this is a native login redirect (Bouncer flow)
            // If so, we must ignore it here so App.tsx can bounce it to the native app.
            // If we consume the code here, it becomes invalid for the native app.
            const params = new URLSearchParams(window.location.search);
            if (params.get('state') === 'is_native_login') {
                console.log('[Auth] Detected native login flow, skipping web processing to allow bounce.');
                return; 
            }

            console.log('[Auth] Processing OAuth callback...');
            setAuthStatus('authenticating');
            try {
                await processAuthCallback();
                console.log('[Auth] Login successful');
                window.history.replaceState({}, document.title, window.location.pathname);
                setAuthStatus('linked');
                // Set GA cross-device User-ID, then record the sign-in.
                await applyGaUserId();
                trackLogin();
            } catch (e) {
                console.error('[Auth] Callback processing failed', e);
                setAuthStatus('error');
                setAuthError('Authentication failed. Please try again.');
            }
        }
    };
    handleAuth();
  }, []);

  // Check token validity periodically if linked
  useEffect(() => {
    if (authStatus === 'linked') {
        // Initialize GAPI/client if needed
        initializeGoogleAuth();
    }
  }, [authStatus]);

  return {
    authStatus,
    authError,
    login: handleLogin,
    unlink: handleUnlink,
    getAccessToken,
    recheckAuth
  };
};
