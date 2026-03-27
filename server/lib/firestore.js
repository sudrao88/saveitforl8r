/**
 * Shared Firestore utilities for async result persistence and polling.
 *
 * Eliminates duplicated persistence functions (persistEnrichmentResult,
 * persistMomentResult, persistSynthesisResult) and duplicated results
 * polling handlers across routes.
 */

/**
 * Creates a persist function for a specific Firestore collection.
 * The returned function stores async processing results with TTL-based expiration.
 *
 * @param {object} db - Firestore instance
 * @param {string} collection - Collection name
 * @param {number} successTtlMs - TTL for successful results
 * @param {number} failedTtlMs - TTL for failed results
 * @returns {(docId: string, userId: string, status: string, result: any) => void}
 */
export function createResultPersister(db, collection, successTtlMs, failedTtlMs) {
  return async (docId, userId, status, result) => {
    if (!db || !docId) return;

    const docRef = db.collection(collection).doc(docId);

    try {
      // Verify ownership: only allow overwrite if doc doesn't exist or belongs to this user
      const existing = await docRef.get();
      if (existing.exists && existing.data().userId !== userId) {
        console.warn(`[Firestore] Ownership mismatch for ${collection}/${docId}: requested by ${userId}, owned by ${existing.data().userId}`);
        return;
      }

      const doc = {
        userId,
        status,
        createdAt: Date.now(),
        expireAt: new Date(Date.now() + (status === 'completed' ? successTtlMs : failedTtlMs)),
      };
      if (result) doc.result = result;
      await docRef.set(doc);
    } catch (err) {
      console.error(`[Firestore] Failed to persist ${collection}/${docId}:`, err.message);
    }
  };
}

/**
 * Creates an Express route handler for polling async results from Firestore.
 * All three polling endpoints (enrich/results, create-moment/results,
 * synthesize/results) share the same logic: fetch docs, check ownership,
 * return status.
 *
 * @param {object} db - Firestore instance
 * @param {string} collection - Firestore collection name
 * @param {string} idsField - Request body field containing the IDs array (e.g. 'memoryIds')
 * @param {string} logLabel - Label for console logging (e.g. '[Results]')
 * @returns {(req, res) => Promise<void>} Express route handler
 */
export function createResultsHandler(db, collection, idsField, logLabel) {
  return async (req, res) => {
    const ids = req.body[idsField];

    if (!db) return res.status(503).json({ error: 'Result recovery unavailable' });

    try {
      console.log(`${logLabel} [${req.requestId}] user=${req.userId} ${idsField}=${ids.length}`);
      const docRefs = ids.map(id => db.collection(collection).doc(id));
      const snapshots = await db.getAll(...docRefs);

      const results = {};
      for (let i = 0; i < ids.length; i++) {
        const snap = snapshots[i];
        if (!snap.exists) { results[ids[i]] = { status: 'not_found' }; continue; }

        const data = snap.data();
        if (data.userId !== req.userId) { results[ids[i]] = { status: 'not_found' }; continue; }

        if (data.status === 'completed' && data.result) {
          results[ids[i]] = { status: 'completed', data: data.result };
        } else if (data.status === 'failed') {
          results[ids[i]] = { status: 'failed' };
        } else {
          results[ids[i]] = { status: data.status || 'processing' };
        }
      }

      res.json({ results });
    } catch (error) {
      console.error(`${logLabel} [${req.requestId}] Failed:`, error.message);
      res.status(500).json({ error: `Failed to fetch results` });
    }
  };
}
