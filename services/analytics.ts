import ReactGA from 'react-ga4';
import { ANALYTICS_EVENTS } from '../constants';

export const GA_MEASUREMENT_ID = 'G-46ENBSFN2D';

export const initGA = () => {
  ReactGA.initialize(GA_MEASUREMENT_ID);
};

/**
 * Set the GA4 User-ID so all subsequent events are attributed to the same
 * person across devices and browsers.
 *
 * The value is a SHA-256 hash (via Web Crypto) of the Google account's stable
 * OpenID `sub` claim. Because `sub` is identical for a given Google account on
 * every device, the same person signing in anywhere maps to one GA user — so
 * GA4 counts them once and its new vs. returning user reporting works
 * cross-device. The hash keeps the identifier pseudonymous in GA.
 */
export const setUserId = (userId: string) => {
  ReactGA.set({ userId });
};

export const clearUserId = () => {
  ReactGA.set({ userId: undefined });
};

/**
 * Track a Google sign-in. Signing in is the same action as linking Google
 * Drive, so this fires once whenever a user successfully links their account.
 */
export const trackLogin = () => {
  ReactGA.event(ANALYTICS_EVENTS.LOGIN, { method: 'Google' });
};

/**
 * Track a note being saved. Fired once per saved note so the total count of
 * notes saved per user can be derived in GA4.
 */
export const trackNoteSaved = () => {
  ReactGA.event(ANALYTICS_EVENTS.NOTE_SAVED);
};
