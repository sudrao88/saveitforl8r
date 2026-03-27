/**
 * Push subscription management routes.
 * Stores device tokens for FCM (Android) and APNS (iOS) silent push.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { authenticateRequest } from '../middleware/auth.js';

/**
 * Create a deterministic document ID from a push token.
 * Uses SHA-256 to produce a fixed-length, Firestore-safe key
 * that prevents duplicate subscriptions for the same token.
 * @param {string} token - The push subscription token
 * @returns {string} Hex-encoded hash
 */
const tokenToDocId = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const PUSH_COLLECTION = 'push-subscriptions';
const VALID_PLATFORMS = ['android', 'ios'];

export const createPushRouter = ({ db }) => {
  const router = Router();

  // --- POST /api/push/subscribe — Register or update a push subscription ---
  router.post('/subscribe', authenticateRequest, async (req, res) => {
    const { token, platform } = req.body;

    // Validate body
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required and must be a string' });
    }
    if (token.length > 4096) {
      return res.status(400).json({ error: 'token exceeds maximum length (4096 chars)' });
    }
    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
    }

    if (!db) {
      return res.status(503).json({ error: 'Subscription storage unavailable' });
    }

    try {
      const docId = tokenToDocId(token);
      await db.collection(PUSH_COLLECTION).doc(docId).set({
        userId: req.userId,
        token,
        platform,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      console.log(`[Push] Subscription registered: user=${req.userId} platform=${platform}`);
      res.json({ status: 'subscribed' });
    } catch (err) {
      console.error(`[Push] Failed to register subscription:`, err.message);
      res.status(500).json({ error: 'Failed to register push subscription' });
    }
  });

  // --- DELETE /api/push/unsubscribe — Remove a push subscription ---
  router.delete('/unsubscribe', authenticateRequest, async (req, res) => {
    const { token } = req.body;

    // Validate body
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required and must be a string' });
    }

    if (!db) {
      return res.status(503).json({ error: 'Subscription storage unavailable' });
    }

    try {
      const docId = tokenToDocId(token);
      const docRef = db.collection(PUSH_COLLECTION).doc(docId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // Verify ownership — only the subscribing user can unsubscribe
      if (doc.data().userId !== req.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await docRef.delete();
      console.log(`[Push] Subscription removed: user=${req.userId}`);
      res.json({ status: 'unsubscribed' });
    } catch (err) {
      console.error(`[Push] Failed to remove subscription:`, err.message);
      res.status(500).json({ error: 'Failed to remove push subscription' });
    }
  });

  return router;
};
