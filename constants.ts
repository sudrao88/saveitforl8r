export const STORAGE_KEYS = {
  HAS_SEEN_SHARE_ONBOARDING: 'hasSeenShareOnboarding',
} as const;

/**
 * Google Analytics (GA4) events. We deliberately track only three things:
 *
 *  1. `login`      — fired when a user signs in with their Google account
 *                    (which is the same action as linking Google Drive).
 *  2. user identity — every event is attributed to a stable, cross-device
 *                    GA4 User-ID derived from the Google account's OpenID
 *                    `sub` claim, so the same person on different
 *                    devices/browsers counts as one user (and GA4's new vs.
 *                    returning reporting works across devices). This is set
 *                    via `setUserId` in `services/analytics.ts`, not an event.
 *  3. `note_saved` — fired once per note a user saves, so the total number
 *                    of notes saved per user can be derived in GA4.
 *
 * GA4 event names are lowercase snake_case per Google's recommendations.
 */
export const ANALYTICS_EVENTS = {
  LOGIN: 'login',
  NOTE_SAVED: 'note_saved',
} as const;
