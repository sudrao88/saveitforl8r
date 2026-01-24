import { useState, useCallback, useEffect } from 'react';
import { 
    initializeGoogleAuth, 
    loginToDrive, 
    isLinked as checkIsLinked, 
    unlinkDrive,
    getAccessToken,
    processAuthCallback
} from '../services/googleDriveService';
import { ANALYTICS_EVENTS } from '../constants';
import { logEvent } from '../services/analytics';

export type AuthStatus = 'unlinked' | 'linked' | 'authenticating' | 'error';

export const useAuth = () => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(checkIsLinked() ? 'linked' : 'unlinked');
  const [authError, setAuthError] = useState<string | null>(null);

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

  const handleUnlink = useCallback(() => {
    unlinkDrive();
    setAuthStatus('unlinked');
    logEvent(ANALYTICS_EVENTS.AUTH.CATEGORY, ANALYTICS_EVENTS.AUTH.ACTION_LOGOUT);
  }, []);

  // Handle OAuth Callback
  useEffect(() => {
    const handleAuth = async () => {
        if (window.location.search.includes('code=')) {
            console.log('[Auth] Processing OAuth callback...');
            setAuthStatus('authenticating');
            try {
                await processAuthCallback();
                console.log(`[Auth] ${ANALYTICS_EVENTS.AUTH.ACTION_LOGIN_SUCCESS}`);
                window.history.replaceState({}, document.title, window.location.pathname);
                setAuthStatus('linked');
                logEvent(ANALYTICS_EVENTS.AUTH.CATEGORY, ANALYTICS_EVENTS.AUTH.ACTION_LOGIN_SUCCESS);
            } catch (e) {
                console.error(`[Auth] ${ANALYTICS_EVENTS.AUTH.ACTION_CALLBACK_FAILED}`, e);
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
    getAccessToken
  };
};
