import { useState, useEffect, useRef } from 'react';
import { isNative } from '../services/platform';

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
