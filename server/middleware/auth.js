/**
 * Authentication middleware — validates Google OAuth tokens
 * and caches validated tokens for 5 minutes to reduce latency.
 */
import crypto from 'crypto';

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOKEN_CACHE_MAX_SIZE = 10_000; // Cap to prevent unbounded memory growth

const tokenCache = new Map();

// --- Audience allowlist ---
// Two apps (saveitforl8r + l8rgram) each have their own OAuth client id, so the
// server must accept tokens minted for either. `GOOGLE_ALLOWED_AUDIENCES` is a
// comma-separated allowlist; if unset we fall back to the single GOOGLE_CLIENT_ID
// for backward compatibility. Parsed once and cached as a Set for O(1) lookup.
let _allowedAudiences = null;

export const getAllowedAudiences = () => {
  if (_allowedAudiences) return _allowedAudiences;
  const raw = process.env.GOOGLE_ALLOWED_AUDIENCES;
  const list = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (list.length === 0) {
    const fallback = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (fallback) list.push(fallback);
  }
  _allowedAudiences = new Set(list);
  return _allowedAudiences;
};

/** Test hook — clears the memoized allowlist so env changes take effect. */
export const _resetAudienceCache = () => {
  _allowedAudiences = null;
};

// Periodic cache cleanup. unref() so this timer never keeps the process alive
// (matters under `node --test`, which otherwise hangs waiting for the loop).
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenCache) {
    if (now >= val.expiresAt) tokenCache.delete(key);
  }
}, 60_000).unref();

export const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Auth required' });
  }
  const accessToken = authHeader.slice(7);
  req.accessToken = accessToken;

  const tokenHash = crypto
    .createHash('sha256')
    .update(accessToken)
    .digest('hex');
  const cached = tokenCache.get(tokenHash);
  if (cached && Date.now() < cached.expiresAt) {
    req.userId = cached.userId;
    // Surface the cached scope so requireScope() avoids a network round-trip.
    req.tokenInfo = { scope: cached.scope };
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
    const allowedAudiences = getAllowedAudiences();
    if (allowedAudiences.size === 0) {
      console.error(`[Auth] [${req.requestId}] No allowed audiences configured — rejecting request`);
      return res.status(500).json({ error: 'Server misconfigured' });
    }
    if (!allowedAudiences.has(tokenInfo.aud)) {
      // aud is an OAuth client id (not PII) — log it at info level to aid
      // debugging a mis-set GOOGLE_ALLOWED_AUDIENCES allowlist.
      console.info(
        `[Auth] [${req.requestId}] Rejected audience not in allowlist: ${tokenInfo.aud}`
      );
      return res.status(403).json({ error: 'Audience mismatch' });
    }
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';
    req.tokenInfo = tokenInfo;

    // Evict oldest entries if cache is at capacity
    if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
      const firstKey = tokenCache.keys().next().value;
      tokenCache.delete(firstKey);
    }

    tokenCache.set(tokenHash, {
      userId: req.userId,
      scope: tokenInfo.scope || '',
      expiresAt: Date.now() + TOKEN_CACHE_TTL,
    });

    next();
  } catch (err) {
    console.error(`[Auth] [${req.requestId}] Auth check error:`, err.message);
    return res.status(401).json({ error: 'Auth failed' });
  }
};
