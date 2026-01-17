import { useState, useEffect } from 'react';

export const useServiceWorker = () => {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
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

      // Handle controller change (reload)
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
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
          waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
  };

  return { registration, updateAvailable, updateApp, appVersion };
};
