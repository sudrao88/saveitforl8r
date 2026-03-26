/**
 * Native background sync bridge for Android (WorkManager) and iOS (BGTask).
 * Provides a unified interface for registering and managing periodic
 * background sync tasks on native platforms.
 */

import { Capacitor } from '@capacitor/core';
import { isNative } from './platform';

/**
 * Initialize native background sync.
 * Called once on app startup after authentication.
 * On Android: WorkManager is registered via native code in MainActivity.
 * On iOS: BGAppRefreshTask is registered via AppDelegate.
 * This function handles any additional JS-side setup needed.
 */
export const initNativeBackgroundSync = async (): Promise<void> => {
  if (!isNative()) return;

  try {
    const platform = Capacitor.getPlatform();
    console.log(`[NativeBackgroundSync] Initialized on ${platform}`);
  } catch (err) {
    console.error('[NativeBackgroundSync] Init error:', err);
  }
};

/**
 * Start a foreground sync service (Android only).
 * Shows a persistent notification with sync progress.
 * Used for user-initiated bulk sync operations.
 */
export const startForegroundSync = async (totalItems: number): Promise<void> => {
  if (!isNative()) return;
  if (Capacitor.getPlatform() !== 'android') return;

  try {
    window.AndroidBridge?.startForegroundSync(totalItems);
  } catch (err) {
    console.error('[NativeBackgroundSync] Failed to start foreground sync:', err);
  }
};

/**
 * Update foreground sync progress (Android only).
 */
export const updateForegroundSyncProgress = async (current: number, total: number): Promise<void> => {
  if (!isNative()) return;

  try {
    window.AndroidBridge?.updateSyncProgress(current, total);
  } catch {
    // Best-effort — notification update failures are non-critical
  }
};

/**
 * Stop the foreground sync service (Android only).
 */
export const stopForegroundSync = async (): Promise<void> => {
  if (!isNative()) return;

  try {
    window.AndroidBridge?.stopForegroundSync();
  } catch {
    // Best-effort — service stop failures are non-critical
  }
};
