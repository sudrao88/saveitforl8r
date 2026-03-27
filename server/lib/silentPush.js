/**
 * Silent push sender for background data sync.
 * Sends FCM data messages (Android) and APNS silent pushes (iOS)
 * to wake the app and trigger background data fetching.
 *
 * No visible notification is shown to the user.
 */

let admin;
let messagingAvailable = false;

try {
  admin = await import('firebase-admin');
  // Initialize Firebase Admin only if not already initialized
  if (admin.default.apps.length === 0) {
    admin.default.initializeApp();
  }
  messagingAvailable = true;
  console.log('[SilentPush] Firebase Admin messaging initialized');
} catch (err) {
  console.warn('[SilentPush] Firebase Admin not available (silent push disabled):', err.message);
}

/**
 * Send a silent push to wake the client app for background data processing.
 * @param {string} userId - The user's ID (to look up their push subscription)
 * @param {Object} data - Data payload to include in the push
 * @param {string} data.type - Type of completion ('enrichment-complete' | 'moment-complete' | 'synthesis-complete')
 * @param {string} [data.memoryId] - The ID of the completed memory
 * @param {string} [data.momentId] - The ID of the completed moment
 * @param {import('@google-cloud/firestore').Firestore} db - Firestore instance
 * @returns {Promise<Array>} Array of send results
 */
export async function sendSilentPush(userId, data, db) {
  if (!messagingAvailable) {
    console.warn('[SilentPush] Skipping — Firebase Admin messaging not available');
    return [];
  }

  if (!db) {
    console.warn('[SilentPush] Skipping — Firestore not available');
    return [];
  }

  try {
    // Look up user's push subscriptions from Firestore
    const subscriptionsRef = db.collection('push-subscriptions').where('userId', '==', userId);
    const snapshot = await subscriptionsRef.get();

    if (snapshot.empty) return []; // No subscriptions, nothing to send

    const results = [];
    for (const doc of snapshot.docs) {
      const sub = doc.data();
      try {
        if (sub.platform === 'android') {
          // FCM data message — truly silent, no notification shown
          await admin.default.messaging().send({
            token: sub.token,
            data: {
              type: data.type,
              memoryId: data.memoryId || '',
              momentId: data.momentId || '',
            },
            android: {
              priority: 'high', // Wake device from Doze
            },
          });
          results.push({ platform: 'android', success: true });
        } else if (sub.platform === 'ios') {
          // APNS silent push — content-available: 1, no alert/badge/sound
          await admin.default.messaging().send({
            token: sub.token,
            data: {
              type: data.type,
              memoryId: data.memoryId || '',
              momentId: data.momentId || '',
            },
            apns: {
              headers: { 'apns-priority': '5' }, // Silent pushes must use priority 5
              payload: {
                aps: { 'content-available': 1 },
              },
            },
          });
          results.push({ platform: 'ios', success: true });
        }
      } catch (err) {
        console.error(`[SilentPush] Failed to send to ${sub.platform}:`, err.message);
        // If token is invalid, clean it up
        if (err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token') {
          await doc.ref.delete();
          console.log(`[SilentPush] Removed stale ${sub.platform} token for user ${userId}`);
        }
        results.push({ platform: sub.platform, success: false, error: err.message });
      }
    }

    return results;
  } catch (err) {
    console.error('[SilentPush] Error:', err.message);
    return [];
  }
}
