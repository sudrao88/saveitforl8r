/**
 * Authentication middleware — validates Google OAuth tokens
 * and caches validated tokens for 5 minutes to reduce latency.
 */
import crypto from 'crypto';

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOKEN_CACHE_MAX_SIZE = 10_000; // Cap to prevent unbounded memory growth

const tokenCache = new Map();

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenCache) {
    if (now >= val.expiresAt) tokenCache.delete(key);
  }
}, 60_000);

export const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Auth required' });
  }
  const accessToken = authHeader.slice(7);

  const tokenHash = crypto
    .createHash('sha256')
    .update(accessToken)
    .digest('hex');
  const cached = tokenCache.get(tokenHash);
  if (cached && Date.now() < cached.expiresAt) {
    req.userId = cached.userId;
    return next();
  }

  try {
    const response = await fetch(
      `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!response.ok) {
      console.error(
        `[Auth] [${req.requestId}] Token validation failed: ${response.status}`
      );
      return res.status(401).json({ error: 'Invalid token' });
    }
    const tokenInfo = await response.json();
    const expectedClientId =
      process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (!expectedClientId) {
      console.error(`[Auth] [${req.requestId}] GOOGLE_CLIENT_ID not configured — rejecting request`);
      return res.status(500).json({ error: 'Server misconfigured' });
    }
    if (tokenInfo.aud !== expectedClientId) {
      console.error(
        `[Auth] [${req.requestId}] Audience mismatch. Expected: ${expectedClientId}, Got: ${tokenInfo.aud}`
      );
      return res.status(403).json({ error: 'Audience mismatch' });
    }
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';

    // Evict oldest entries if cache is at capacity
    if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
      const firstKey = tokenCache.keys().next().value;
      tokenCache.delete(firstKey);
    }

    tokenCache.set(tokenHash, {
      userId: req.userId,
      expiresAt: Date.now() + TOKEN_CACHE_TTL,
    });

    next();
  } catch (err) {
    console.error(`[Auth] [${req.requestId}] Auth check error:`, err.message);
    return res.status(401).json({ error: 'Auth failed' });
  }
};
