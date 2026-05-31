/**
 * Calendar route — proxies the user's live Google Calendar.
 *
 * Unlike the Gemini routes, this endpoint forwards to Google using the caller's
 * OWN OAuth access token (req.accessToken) — the server never uses its Gemini
 * key here. Gated by requireScope(calendar.readonly) so only l8rgram (which
 * requests that scope) can reach it; saveitforl8r tokens are 403'd.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { requireScope } from '../middleware/requireScope.js';
import { validateCalendarQuery } from '../middleware/validation.js';

const CALENDAR_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const createCalendarRouter = () => {
  const router = Router();

  const calendarLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  router.get(
    '/events',
    authenticateRequest,
    requireScope(CALENDAR_SCOPE),
    validateCalendarQuery,
    calendarLimiter,
    async (req, res) => {
      const { timeMin, timeMax, pageToken } = req.query;

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      if (pageToken) params.set('pageToken', pageToken);

      try {
        const upstream = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${req.accessToken}` },
        });

        // The user's token is no longer valid for Google — tell the client to
        // re-prompt for consent rather than surfacing a generic error.
        if (upstream.status === 401) {
          return res.status(401).json({ error: 'reauth_required' });
        }

        if (!upstream.ok) {
          const body = await upstream.text().catch(() => '');
          console.error(
            `[Calendar] [${req.requestId}] Upstream error ${upstream.status}: ${body.slice(0, 200)}`
          );
          return res
            .status(502)
            .json({ error: 'calendar_upstream_error', status: upstream.status });
        }

        const data = await upstream.json();
        // Return the upstream JSON unchanged on success; the client maps the
        // Google event shape into its own LiveCalendarEvent model.
        res.json(data);
      } catch (err) {
        console.error(`[Calendar] [${req.requestId}] Fetch failed:`, err.message);
        res.status(500).json({ error: 'calendar_fetch_failed' });
      }
    }
  );

  return router;
};
