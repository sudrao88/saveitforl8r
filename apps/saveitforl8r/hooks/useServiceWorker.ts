import { useState, useEffect, useRef } from 'react';
import { isNative } from '@l8r/shared/platform';

/**
 * Register Periodic Background Sync for installed PWA (Chrome only).
 * Runs the full sync cycle (enrichment recovery + Drive sync) every ~12 hours
 * even when no tabs are open. Chrome decides actual timing based on engagement score.
 */
const registerPeriodicBackgroundSync = async (reg: ServiceWorkerRegistration) => {
  try {
    // Feature-detect Periodic Background Sync (Chrome only, installed PWA)
    if (!('periodicSync' in reg)) return;

    const periodicSync = (reg as any).periodicSync;
    const tags = await periodicSync.getTags();
    if (tags.includes('full-sync')) return; // Already registered

    await periodicSync.register('full-sync', {
      minInterval: 12 * 60 * 60 * 1000, // 12 hours
    });
    console.log('[SW] Periodic Background Sync registered (full-sync, 12hr)');
  } catch (err) {
    // Expected to fail on non-Chrome or without engagement score
    console.debug('[SW] Periodic Background Sync not available:', err);
  }
};

export const useServiceWorker = () => {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  // Track whether the user explicitly triggered the update so we only
  // reload the page in response to their action, never spontaneously.
  const userTriggeredUpdate = useRef(false);

  useEffect(() => {
    // Skip service worker on native - Capacitor handles asset serving
    if (isNative()) return;

    if ('serviceWorker' in navigator) {
      // Register the service worker
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('SW registered: ', reg);
        setRegistration(reg);

        // Register Periodic Background Sync for installed PWA (Chrome only).
        // Silently runs the full sync cycle (enrichment recovery + Drive sync)
        // every ~12 hours even when no tabs are open.
        registerPeriodicBackgroundSync(reg);

        // Check if there's already a waiting worker
        if (reg.waiting) {
            setUpdateAvailable(true);
            setWaitingWorker(reg.waiting);
        }

        // Check active worker for version
        if (reg.active) {
            askForVersion(reg.active);
        }

        // Listen for new updates
        const updateHandler = () => {
            const newWorker = reg.installing;
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        setUpdateAvailable(true);
                        setWaitingWorker(newWorker);
                    }
                });
            }
        };

        reg.addEventListener('updatefound', updateHandler);

        // Check for updates periodically (every hour)
        const intervalId = setInterval(() => {
            reg.update();
        }, 60 * 60 * 1000);

        return () => {
            clearInterval(intervalId);
            reg.removeEventListener('updatefound', updateHandler);
        };
      }).catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });

      // Only reload when the user explicitly clicked "Update".
      // Without this guard, any background SW activation (e.g. from
      // another tab) would yank the page out from under the user.
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing && userTriggeredUpdate.current) {
              refreshing = true;
              window.location.reload();
          }
      });
    }
  }, []);

  const askForVersion = (worker: ServiceWorker) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
          if (event.data.type === 'VERSION') {
              setAppVersion(event.data.version);
          }
      };
      worker.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
  };

  const updateApp = () => {
      if (waitingWorker) {
          userTriggeredUpdate.current = true;
          waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
  };

  return { registration, updateAvailable, updateApp, appVersion };
};
