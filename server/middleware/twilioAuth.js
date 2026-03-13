/**
 * Twilio webhook authentication middleware — validates the
 * X-Twilio-Signature header to ensure requests originate from Twilio.
 */
import { validateWebhookSignature } from '../services/twilio.js';

/**
 * Express middleware that validates Twilio webhook signatures.
 * Reconstructs the full request URL and validates against the signature header.
 */
export const validateTwilioWebhook = (req, res, next) => {
  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.error(`[TwilioAuth] [${req.requestId}] Missing X-Twilio-Signature header`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Reconstruct the full URL as Twilio sees it.
  // In production behind a reverse proxy, use X-Forwarded-Proto and X-Forwarded-Host.
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;

  const isValid = validateWebhookSignature(fullUrl, req.body, signature);
  if (!isValid) {
    console.error(`[TwilioAuth] [${req.requestId}] Invalid Twilio signature for URL: ${fullUrl}`);
    return res.status(403).json({ error: 'Invalid signature' });
  }

  next();
};
