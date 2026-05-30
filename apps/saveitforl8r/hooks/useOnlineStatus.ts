import { useSyncExternalStore } from 'react';

// Shared online/offline state via useSyncExternalStore.
// This replaces per-component event listeners (e.g., every MemoryCard
// registering its own online/offline pair) with a single global listener.

const subscribe = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export const useOnlineStatus = (): boolean => {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
