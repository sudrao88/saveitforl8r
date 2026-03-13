/**
 * WhatsApp routes — handles Twilio webhook for incoming messages,
 * OAuth linking flow, verification code flow, and note fetching.
 */
import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateTwilioWebhook } from '../middleware/twilioAuth.js';
import {
  sendWhatsAppMessage,
  downloadMedia,
  normalizePhoneNumber,
  isTwilioConfigured,
} from '../services/twilio.js';

const WHATSAPP_LINKS_COLLECTION = 'whatsapp-links';
const WHATSAPP_NOTES_COLLECTION = 'whatsapp-notes';
const WHATSAPP_LINK_CODES_COLLECTION = 'whatsapp-link-codes';
const WHATSAPP_OAUTH_STATES_COLLECTION = 'whatsapp-oauth-states';

// Supported media MIME types (matching client-side validation)
const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

// 30-day TTL for notes in Firestore
const NOTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// 10-minute TTL for OAuth state tokens and verification codes
const SHORT_TTL_MS = 10 * 60 * 1000;

/**
 * Create the WhatsApp router.
 * @param {object} deps - Shared dependencies
 * @param {object} deps.db - Firestore instance
 * @param {Function} deps.runBackgroundEnrichment - From enrich.js
 * @param {Function} deps.persistEnrichmentResult - From enrich.js
 */
export const createWhatsAppRouter = ({ db, runBackgroundEnrichment, persistEnrichmentResult }) => {
  const router = Router();

  if (!db) {
    console.warn('[WhatsApp] Firestore unavailable — WhatsApp routes disabled');
    router.all('*', (_req, res) => res.status(503).json({ error: 'WhatsApp service unavailable' }));
    return router;
  }

  if (!isTwilioConfigured()) {
    console.warn('[WhatsApp] Twilio not configured — WhatsApp routes disabled');
    router.all('*', (_req, res) => res.status(503).json({ error: 'WhatsApp service not configured' }));
    return router;
  }

  // --- Rate limiters ---

  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (req) => normalizePhoneNumber(req.body?.From) || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const notesLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  const linkLimiter = rateLimit({
    windowMs: 300_000,
    max: 3,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  const verifyLimiter = rateLimit({
    windowMs: 300_000,
    max: 5,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  // --- Helper functions ---

  /**
   * Look up the userId associated with a WhatsApp phone number.
   * @returns {string|null} userId or null if not linked
   */
  const getUserIdByPhone = async (phone) => {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return null;
    const doc = await db.collection(WHATSAPP_LINKS_COLLECTION).doc(normalized).get();
    return doc.exists ? doc.data().userId : null;
  };

  /**
   * Create a note document in Firestore from a WhatsApp message.
   */
  const createWhatsAppNote = async (userId, noteId, content, attachments) => {
    const noteRef = db.collection(WHATSAPP_NOTES_COLLECTION).doc(userId)
      .collection('notes').doc(noteId);

    await noteRef.set({
      id: noteId,
      timestamp: Date.now(),
      content: content || '',
      attachments: attachments || [],
      tags: [],
      enrichment: null,
      source: 'whatsapp',
      status: 'pending',
      fetchedByClient: false,
      createdAt: Date.now(),
      expireAt: new Date(Date.now() + NOTE_TTL_MS),
    });

    return noteRef;
  };

  /**
   * Update a WhatsApp note with enrichment results.
   */
  const updateNoteWithEnrichment = async (userId, noteId, enrichmentResult) => {
    try {
      const noteRef = db.collection(WHATSAPP_NOTES_COLLECTION).doc(userId)
        .collection('notes').doc(noteId);
      await noteRef.update({
        enrichment: enrichmentResult,
        tags: enrichmentResult.suggestedTags || [],
        status: 'ready',
      });
    } catch (err) {
      console.error(`[WhatsApp] Failed to update note ${noteId} with enrichment:`, err.message);
    }
  };

  // --- POST /api/whatsapp/webhook ---
  // Receives incoming WhatsApp messages from Twilio.
  // Uses URL-encoded body (Twilio's default format).
  router.post(
    '/webhook',
    validateTwilioWebhook,
    webhookLimiter,
    async (req, res) => {
      // Twilio expects a 200 response quickly; always respond with TwiML or empty 200.
      const from = req.body.From; // e.g., 'whatsapp:+14155238886'
      const body = req.body.Body || '';
      const numMedia = parseInt(req.body.NumMedia || '0', 10);

      console.log(`[WhatsApp] [${req.requestId}] Incoming from=${from} body="${body.substring(0, 50)}" media=${numMedia}`);

      try {
        const userId = await getUserIdByPhone(from);

        if (!userId) {
          // User not linked — generate OAuth link
          const stateToken = crypto.randomBytes(24).toString('hex');
          const normalizedPhone = normalizePhoneNumber(from);

          await db.collection(WHATSAPP_OAUTH_STATES_COLLECTION).doc(stateToken).set({
            whatsappNumber: normalizedPhone,
            createdAt: Date.now(),
            expireAt: new Date(Date.now() + SHORT_TTL_MS),
          });

          const oauthRedirectUri = process.env.WHATSAPP_OAUTH_REDIRECT_URI || `${req.protocol}://${req.headers.host}/api/whatsapp/oauth-callback`;
          const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;

          const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(googleClientId)}` +
            `&redirect_uri=${encodeURIComponent(oauthRedirectUri)}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent('openid profile')}` +
            `&state=${stateToken}` +
            `&access_type=online` +
            `&prompt=consent`;

          await sendWhatsAppMessage(from,
            `Welcome to SaveItForL8R! To start saving notes, link your Google account:\n\n${oauthUrl}\n\nOr link from the web app in Settings > WhatsApp.`
          );

          return res.status(200).send('');
        }

        // User is linked — save the note
        const noteId = crypto.randomUUID();
        const attachments = [];

        // Download media attachments
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = req.body[`MediaUrl${i}`];
          const mediaType = req.body[`MediaContentType${i}`];

          if (!mediaUrl || !SUPPORTED_MEDIA_TYPES.has(mediaType)) {
            console.log(`[WhatsApp] [${req.requestId}] Skipping unsupported media type: ${mediaType}`);
            continue;
          }

          try {
            const media = await downloadMedia(mediaUrl);
            attachments.push({
              id: crypto.randomUUID(),
              type: mediaType.startsWith('image/') ? 'image' : 'file',
              mimeType: media.mimeType,
              data: media.data,
              name: `whatsapp-media-${i}.${mediaType.split('/')[1] || 'bin'}`,
            });
          } catch (mediaErr) {
            console.error(`[WhatsApp] [${req.requestId}] Media download failed:`, mediaErr.message);
          }
        }

        // Require either text or at least one attachment
        if (!body.trim() && attachments.length === 0) {
          await sendWhatsAppMessage(from, 'Please send a text message, image, or document to save as a note.');
          return res.status(200).send('');
        }

        // Save note to Firestore
        await createWhatsAppNote(userId, noteId, body.trim(), attachments);

        // Trigger enrichment in background
        runBackgroundEnrichment({
          userId,
          requestId: req.requestId,
          memoryId: noteId,
          text: body.trim(),
          attachments,
          tags: [],
          location: null,
          moments: [],
          onComplete: (enrichmentResult) => {
            updateNoteWithEnrichment(userId, noteId, enrichmentResult);
          },
        });

        await sendWhatsAppMessage(from, 'Note saved! It will appear in your app shortly.');
        return res.status(200).send('');
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Webhook error:`, err.message);
        // Always return 200 to Twilio to prevent retries
        return res.status(200).send('');
      }
    }
  );

  // --- GET /api/whatsapp/oauth-callback ---
  // Handles the OAuth redirect after a WhatsApp user links their Google account.
  router.get('/oauth-callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send('<html><body><h2>Invalid request. Missing authorization code.</h2></body></html>');
    }

    try {
      // Look up state token
      const stateDoc = await db.collection(WHATSAPP_OAUTH_STATES_COLLECTION).doc(state).get();
      if (!stateDoc.exists) {
        return res.status(400).send('<html><body><h2>Link expired. Please send a message to the bot to get a new link.</h2></body></html>');
      }

      const { whatsappNumber } = stateDoc.data();

      // Exchange code for tokens
      const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
      const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.WHATSAPP_OAUTH_REDIRECT_URI || `${req.protocol}://${req.headers.host}/api/whatsapp/oauth-callback`;

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenResponse.ok) {
        console.error(`[WhatsApp] OAuth token exchange failed: ${tokenResponse.status}`);
        return res.status(400).send('<html><body><h2>Authentication failed. Please try again.</h2></body></html>');
      }

      const tokens = await tokenResponse.json();

      // Validate the token and get user info
      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokens.access_token)}`
      );

      if (!tokenInfoResponse.ok) {
        return res.status(400).send('<html><body><h2>Failed to validate token. Please try again.</h2></body></html>');
      }

      const tokenInfo = await tokenInfoResponse.json();
      const userId = tokenInfo.sub || tokenInfo.email;

      if (!userId) {
        return res.status(400).send('<html><body><h2>Could not identify your account. Please try again.</h2></body></html>');
      }

      // Create the link
      await db.collection(WHATSAPP_LINKS_COLLECTION).doc(whatsappNumber).set({
        userId,
        linkedAt: Date.now(),
        whatsappNumber,
      });

      // Delete the state token (single-use)
      await db.collection(WHATSAPP_OAUTH_STATES_COLLECTION).doc(state).delete();

      // Notify via WhatsApp
      const whatsappTo = `whatsapp:${whatsappNumber}`;
      await sendWhatsAppMessage(whatsappTo, 'Account linked! You can now send notes to this chat and they will appear in your SaveItForL8R app.').catch(() => {});

      return res.status(200).send(`
        <html>
        <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #000; color: #f3f4f6;">
          <div style="text-align: center; max-width: 400px; padding: 2rem;">
            <h2 style="color: #22c55e;">Account Linked!</h2>
            <p>Your WhatsApp is now connected to SaveItForL8R. You can close this window and start sending notes.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error(`[WhatsApp] OAuth callback error:`, err.message);
      return res.status(500).send('<html><body><h2>Something went wrong. Please try again.</h2></body></html>');
    }
  });

  // --- GET /api/whatsapp/notes ---
  // Fetch unfetched WhatsApp notes for the authenticated user.
  router.get(
    '/notes',
    authenticateRequest,
    notesLimiter,
    async (req, res) => {
      try {
        const notesRef = db.collection(WHATSAPP_NOTES_COLLECTION).doc(req.userId).collection('notes');
        const snapshot = await notesRef
          .where('fetchedByClient', '==', false)
          .where('status', 'in', ['ready', 'failed', 'pending'])
          .orderBy('createdAt', 'asc')
          .limit(50)
          .get();

        const notes = [];
        for (const doc of snapshot.docs) {
          notes.push(doc.data());
        }

        console.log(`[WhatsApp] [${req.requestId}] user=${req.userId} unfetched notes: ${notes.length}`);
        res.json({ notes });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Failed to fetch notes:`, err.message);
        res.status(500).json({ error: 'Failed to fetch WhatsApp notes' });
      }
    }
  );

  // --- POST /api/whatsapp/notes/ack ---
  // Mark notes as fetched by the client.
  router.post(
    '/notes/ack',
    authenticateRequest,
    notesLimiter,
    async (req, res) => {
      const { noteIds } = req.body;

      if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
        return res.status(400).json({ error: 'noteIds must be a non-empty array' });
      }
      if (noteIds.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 noteIds per request' });
      }

      try {
        const batch = db.batch();
        for (const noteId of noteIds) {
          const noteRef = db.collection(WHATSAPP_NOTES_COLLECTION).doc(req.userId)
            .collection('notes').doc(noteId);
          batch.update(noteRef, { fetchedByClient: true });
        }
        await batch.commit();

        console.log(`[WhatsApp] [${req.requestId}] user=${req.userId} acknowledged ${noteIds.length} notes`);
        res.json({ acknowledged: noteIds.length });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Failed to acknowledge notes:`, err.message);
        res.status(500).json({ error: 'Failed to acknowledge notes' });
      }
    }
  );

  // --- POST /api/whatsapp/link ---
  // Initiate WhatsApp linking from the web app. Sends a verification code via WhatsApp.
  router.post(
    '/link',
    authenticateRequest,
    linkLimiter,
    async (req, res) => {
      const { whatsappNumber } = req.body;

      if (!whatsappNumber || typeof whatsappNumber !== 'string') {
        return res.status(400).json({ error: 'whatsappNumber is required' });
      }

      const normalized = normalizePhoneNumber(whatsappNumber);
      if (!normalized || normalized.length < 8) {
        return res.status(400).json({ error: 'Invalid phone number format. Use E.164 format (e.g., +14155238886)' });
      }

      try {
        // Check if this number is already linked to a different user
        const existingLink = await db.collection(WHATSAPP_LINKS_COLLECTION).doc(normalized).get();
        if (existingLink.exists && existingLink.data().userId !== req.userId) {
          return res.status(409).json({ error: 'This WhatsApp number is already linked to another account' });
        }

        // Generate 6-digit verification code
        const code = String(crypto.randomInt(100000, 999999));

        await db.collection(WHATSAPP_LINK_CODES_COLLECTION).doc(code).set({
          userId: req.userId,
          whatsappNumber: normalized,
          createdAt: Date.now(),
          expireAt: new Date(Date.now() + SHORT_TTL_MS),
        });

        // Send verification code via WhatsApp
        const whatsappTo = `whatsapp:${normalized}`;
        await sendWhatsAppMessage(whatsappTo,
          `Your SaveItForL8R verification code is: ${code}\n\nEnter this code in the app to link your WhatsApp. This code expires in 10 minutes.`
        );

        console.log(`[WhatsApp] [${req.requestId}] Verification code sent to ${normalized} for user ${req.userId}`);
        res.json({ status: 'code_sent' });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Link initiation failed:`, err.message);
        res.status(500).json({ error: 'Failed to send verification code' });
      }
    }
  );

  // --- POST /api/whatsapp/verify ---
  // Verify the code and complete WhatsApp linking from the web app.
  router.post(
    '/verify',
    authenticateRequest,
    verifyLimiter,
    async (req, res) => {
      const { code } = req.body;

      if (!code || typeof code !== 'string' || code.length !== 6) {
        return res.status(400).json({ error: 'Invalid verification code format' });
      }

      try {
        const codeDoc = await db.collection(WHATSAPP_LINK_CODES_COLLECTION).doc(code).get();

        if (!codeDoc.exists) {
          return res.status(400).json({ error: 'Invalid or expired verification code' });
        }

        const codeData = codeDoc.data();

        // Check ownership
        if (codeData.userId !== req.userId) {
          return res.status(403).json({ error: 'Verification code does not belong to this account' });
        }

        // Check expiry
        if (Date.now() > codeData.createdAt + SHORT_TTL_MS) {
          await db.collection(WHATSAPP_LINK_CODES_COLLECTION).doc(code).delete();
          return res.status(400).json({ error: 'Verification code has expired' });
        }

        // Create the link
        await db.collection(WHATSAPP_LINKS_COLLECTION).doc(codeData.whatsappNumber).set({
          userId: req.userId,
          linkedAt: Date.now(),
          whatsappNumber: codeData.whatsappNumber,
        });

        // Clean up the code
        await db.collection(WHATSAPP_LINK_CODES_COLLECTION).doc(code).delete();

        // Notify via WhatsApp
        const whatsappTo = `whatsapp:${codeData.whatsappNumber}`;
        await sendWhatsAppMessage(whatsappTo,
          'Account linked! You can now send notes to this chat and they will appear in your SaveItForL8R app.'
        ).catch(() => {});

        console.log(`[WhatsApp] [${req.requestId}] User ${req.userId} linked WhatsApp ${codeData.whatsappNumber}`);
        res.json({ status: 'linked', whatsappNumber: codeData.whatsappNumber });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Verification failed:`, err.message);
        res.status(500).json({ error: 'Verification failed' });
      }
    }
  );

  // --- GET /api/whatsapp/status ---
  // Check if the current user has a linked WhatsApp number.
  router.get(
    '/status',
    authenticateRequest,
    notesLimiter,
    async (req, res) => {
      try {
        // Query the links collection for this userId
        const snapshot = await db.collection(WHATSAPP_LINKS_COLLECTION)
          .where('userId', '==', req.userId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return res.json({ linked: false });
        }

        const linkData = snapshot.docs[0].data();
        res.json({
          linked: true,
          whatsappNumber: linkData.whatsappNumber,
          linkedAt: linkData.linkedAt,
        });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Status check failed:`, err.message);
        res.status(500).json({ error: 'Failed to check WhatsApp status' });
      }
    }
  );

  // --- DELETE /api/whatsapp/link ---
  // Unlink WhatsApp from the current user's account.
  router.delete(
    '/link',
    authenticateRequest,
    linkLimiter,
    async (req, res) => {
      try {
        const snapshot = await db.collection(WHATSAPP_LINKS_COLLECTION)
          .where('userId', '==', req.userId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return res.status(404).json({ error: 'No WhatsApp number linked' });
        }

        const docId = snapshot.docs[0].id;
        await db.collection(WHATSAPP_LINKS_COLLECTION).doc(docId).delete();

        console.log(`[WhatsApp] [${req.requestId}] User ${req.userId} unlinked WhatsApp`);
        res.json({ status: 'unlinked' });
      } catch (err) {
        console.error(`[WhatsApp] [${req.requestId}] Unlink failed:`, err.message);
        res.status(500).json({ error: 'Failed to unlink WhatsApp' });
      }
    }
  );

  return router;
};
