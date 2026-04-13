/**
 * Chunked resumable file upload endpoint.
 *
 * Large files are uploaded in ~1MB chunks, stored durably in Firestore,
 * then assembled and uploaded to the Gemini File API. The resulting
 * fileUri is returned to the client for use in enrichment requests.
 *
 * Endpoints:
 *   POST   /              — Initialize an upload session
 *   PUT    /:sessionId/:chunkIndex — Upload a single chunk
 *   GET    /:sessionId/status      — Query session status
 */

import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { FieldValue } from '@google-cloud/firestore';
import { authenticateRequest } from '../middleware/auth.js';
import { validateUploadInit, validateUploadChunk, UUID_REGEX } from '../middleware/validation.js';

const UPLOAD_COLLECTION = 'upload-sessions';
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CHUNK_BYTES = 1.1 * 1024 * 1024; // 1.1MB (slight buffer)

export const createUploadRouter = ({ ai, db }) => {
  const router = Router();

  if (!db) {
    // Firestore is required for chunk persistence
    router.all('*', (_req, res) => res.status(503).json({ error: 'Upload service unavailable' }));
    return router;
  }

  // --- Rate limiters ---

  const initLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  const chunkLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  const statusLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  // --- POST / — Initialize upload session ---

  router.post(
    '/',
    authenticateRequest,
    validateUploadInit,
    initLimiter,
    async (req, res) => {
      const { fileName, fileSize, mimeType, totalChunks, memoryId } = req.body;
      const sessionId = crypto.randomUUID();

      try {
        await db.collection(UPLOAD_COLLECTION).doc(sessionId).set({
          userId: req.userId,
          fileName,
          fileSize,
          mimeType,
          totalChunks,
          memoryId,
          receivedChunks: [],
          status: 'uploading',
          fileUri: null,
          geminiFileName: null,
          createdAt: Date.now(),
          expireAt: new Date(Date.now() + UPLOAD_TTL_MS),
        });

        console.log(`[Upload] [${req.requestId}] Session created: ${sessionId} for ${fileName} (${totalChunks} chunks, ${fileSize} bytes)`);
        res.json({ sessionId });
      } catch (err) {
        console.error(`[Upload] [${req.requestId}] Init failed:`, err.message);
        res.status(500).json({ error: 'Failed to create upload session' });
      }
    }
  );

  // --- PUT /:sessionId/:chunkIndex — Upload a chunk ---

  router.put(
    '/:sessionId/:chunkIndex',
    authenticateRequest,
    validateUploadChunk,
    chunkLimiter,
    express.raw({ type: 'application/octet-stream', limit: '1.2mb' }),
    async (req, res) => {
      const { sessionId } = req.params;
      const chunkIndex = req.chunkIndex; // Set by validateUploadChunk

      if (!req.body || req.body.length === 0) {
        return res.status(400).json({ error: 'Empty chunk body' });
      }
      if (req.body.length > MAX_CHUNK_BYTES) {
        return res.status(400).json({ error: 'Chunk too large' });
      }

      try {
        const sessionRef = db.collection(UPLOAD_COLLECTION).doc(sessionId);
        const sessionDoc = await sessionRef.get();

        if (!sessionDoc.exists) {
          return res.status(404).json({ error: 'Upload session not found' });
        }

        const session = sessionDoc.data();

        if (session.userId !== req.userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (session.status !== 'uploading') {
          // Session already completed or assembling — return current state
          if (session.status === 'completed') {
            return res.json({ status: 'complete', fileUri: session.fileUri, geminiFileName: session.geminiFileName });
          }
          return res.status(409).json({ error: `Session status is '${session.status}', cannot accept chunks` });
        }
        if (chunkIndex >= session.totalChunks) {
          return res.status(400).json({ error: `chunkIndex ${chunkIndex} exceeds totalChunks ${session.totalChunks}` });
        }

        // Check for duplicate chunk (idempotent)
        if (session.receivedChunks.includes(chunkIndex)) {
          return res.json({ status: 'received', duplicate: true });
        }

        // Store chunk in subcollection
        await sessionRef.collection('chunks').doc(String(chunkIndex)).set({
          data: Buffer.from(req.body),
          size: req.body.length,
          receivedAt: Date.now(),
        });

        // Update received chunks list
        await sessionRef.update({
          receivedChunks: FieldValue.arrayUnion(chunkIndex),
        });

        // Check if all chunks have been received
        const updatedDoc = await sessionRef.get();
        const updatedSession = updatedDoc.data();

        if (updatedSession.receivedChunks.length >= session.totalChunks) {
          // All chunks received — start assembly
          await sessionRef.update({ status: 'assembling' });
          console.log(`[Upload] [${req.requestId}] All ${session.totalChunks} chunks received for ${sessionId}, starting assembly`);

          res.json({ status: 'assembling' });

          // Assembly runs after response is sent
          assembleAndUpload(sessionId, session, ai, db, req.requestId).catch((err) => {
            console.error(`[Upload] Assembly error for ${sessionId}:`, err.message);
          });
        } else {
          res.json({ status: 'received' });
        }
      } catch (err) {
        console.error(`[Upload] [${req.requestId}] Chunk ${chunkIndex} failed for ${sessionId}:`, err.message);
        res.status(500).json({ error: 'Failed to store chunk' });
      }
    }
  );

  // --- GET /:sessionId/status — Query session status ---

  router.get(
    '/:sessionId/status',
    authenticateRequest,
    statusLimiter,
    async (req, res) => {
      const { sessionId } = req.params;

      if (!sessionId || !UUID_REGEX.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid sessionId' });
      }

      try {
        const sessionDoc = await db.collection(UPLOAD_COLLECTION).doc(sessionId).get();

        if (!sessionDoc.exists) {
          return res.status(404).json({ error: 'Upload session not found' });
        }

        const session = sessionDoc.data();

        if (session.userId !== req.userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({
          status: session.status,
          receivedChunks: session.receivedChunks,
          totalChunks: session.totalChunks,
          fileUri: session.fileUri,
          geminiFileName: session.geminiFileName,
        });
      } catch (err) {
        console.error(`[Upload] [${req.requestId}] Status check failed for ${sessionId}:`, err.message);
        res.status(500).json({ error: 'Failed to check upload status' });
      }
    }
  );

  return router;
};

// --- Background assembly and Gemini File API upload ---

async function assembleAndUpload(sessionId, sessionData, ai, db, requestId) {
  const sessionRef = db.collection(UPLOAD_COLLECTION).doc(sessionId);

  try {
    // 1. Read all chunks from subcollection, ordered by index
    const chunksSnap = await sessionRef.collection('chunks').get();

    // 2. Build ordered buffer array
    const chunkMap = new Map();
    chunksSnap.docs.forEach((doc) => {
      chunkMap.set(parseInt(doc.id, 10), doc.data().data);
    });

    const buffers = [];
    for (let i = 0; i < sessionData.totalChunks; i++) {
      const chunk = chunkMap.get(i);
      if (!chunk) throw new Error(`Missing chunk ${i}`);
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fullBuffer = Buffer.concat(buffers);

    // 3. Verify total size is reasonable
    if (Math.abs(fullBuffer.length - sessionData.fileSize) > 4096) {
      throw new Error(`Size mismatch: expected ${sessionData.fileSize}, got ${fullBuffer.length}`);
    }

    console.log(`[Upload] [${requestId}] Assembled ${fullBuffer.length} bytes for ${sessionId}, uploading to Gemini`);

    // 4. Upload to Gemini File API
    const blob = new Blob([fullBuffer], { type: sessionData.mimeType });
    const uploadResult = await ai.files.upload({
      file: blob,
      config: { mimeType: sessionData.mimeType },
    });

    // 5. Update session with result
    await sessionRef.update({
      status: 'completed',
      fileUri: uploadResult.uri,
      geminiFileName: uploadResult.name,
    });

    console.log(`[Upload] [${requestId}] Assembly complete for ${sessionId}: ${uploadResult.name} (${uploadResult.uri})`);

    // 6. Clean up chunk subcollection (best-effort)
    const batch = db.batch();
    chunksSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.commit().catch((err) =>
      console.error(`[Upload] Chunk cleanup failed for ${sessionId}:`, err.message)
    );
  } catch (err) {
    console.error(`[Upload] [${requestId}] Assembly failed for ${sessionId}:`, err.message);
    await sessionRef.update({
      status: 'failed',
      error: err.message,
    }).catch(() => {});
  }
}
