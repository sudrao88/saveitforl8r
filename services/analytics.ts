import ReactGA from 'react-ga4';

export const GA_MEASUREMENT_ID = 'G-46ENBSFN2D'; // Replace with actual measurement ID or env variable

export const initGA = () => {
  ReactGA.initialize(GA_MEASUREMENT_ID);
};

export const logEvent = (category: string, action: string, label?: string) => {
  ReactGA.event({
    category,
    action,
    label,
  });
};

export const logPageView = (pageName: string) => {
  ReactGA.send({ hitType: "pageview", page: pageName });
};
