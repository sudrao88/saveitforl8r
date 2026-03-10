import ReactGA from 'react-ga4';

export const GA_MEASUREMENT_ID = 'G-46ENBSFN2D';

export const initGA = () => {
  ReactGA.initialize(GA_MEASUREMENT_ID);
};

/**
 * Set the GA4 user ID so all subsequent events are attributed to this user.
 * ReactGA.set({ userId }) maps to gtag('config', ..., { user_id }) which is
 * the standard GA4 User-ID for cross-device reporting.
 *
 * The value is a SHA-256 hash (via Web Crypto) of the refresh token — a stable,
 * pseudonymous identifier that avoids needing `openid` scope or extra API calls.
 */
export const setUserId = (userId: string) => {
  ReactGA.set({ userId });
};

export const clearUserId = () => {
  ReactGA.set({ userId: undefined });
};

export const logEvent = (category: string, action: string, label?: string, value?: number) => {
  ReactGA.event({
    category,
    action,
    label,
    value,
  });
};

export const logPageView = (pageName: string) => {
  ReactGA.send({ hitType: "pageview", page: pageName });
};
