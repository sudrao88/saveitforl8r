/**
 * requireScope middleware — gates a route on the presence of a specific OAuth
 * scope in the caller's token. Applied ONLY to /api/calendar/* so the shared
 * /api/enrich and /api/query endpoints stay scope-agnostic (both apps reuse
 * them with different scopes).
 *
 * Reads the scope string cached on req.tokenInfo by authenticateRequest, so it
 * adds no extra network round-trip. Must run after authenticateRequest.
 */
export const requireScope = (scope) => (req, res, next) => {
  const scopes = (req.tokenInfo?.scope || '').split(/\s+/);
  if (!scopes.includes(scope)) {
    return res.status(403).json({ error: 'insufficient_scope', required: scope });
  }
  next();
};
