import ReactGA from 'react-ga4';

export const GA_MEASUREMENT_ID = 'G-46ENBSFN2D';

export const initGA = () => {
  ReactGA.initialize(GA_MEASUREMENT_ID);
};

/**
 * Set the GA4 user ID so all subsequent events are attributed to this user.
 * GA4 supports a `user_id` property via gtag('set') which enables cross-device
 * user identity in the GA4 User-ID reporting view.
 *
 * We use a SHA-256 hash of the refresh token as a stable, pseudonymous identifier.
 * This avoids needing to add `openid` scope or make extra API calls to fetch the
 * Google `sub` claim on the client.
 */
export const setUserId = (userId: string) => {
  ReactGA.set({ userId });
  ReactGA.gtag('set', 'user_properties', { user_id: userId });
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
