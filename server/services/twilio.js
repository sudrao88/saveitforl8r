/**
 * Twilio WhatsApp service — sends messages, downloads media,
 * and validates webhook signatures.
 */
import crypto from 'crypto';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Build Basic auth header for Twilio REST API.
 */
const getTwilioAuthHeader = () => {
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * Send a WhatsApp message via Twilio REST API.
 * @param {string} to - Recipient in 'whatsapp:+1234567890' format
 * @param {string} body - Message text
 */
export const sendWhatsAppMessage = async (to, body) => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    throw new Error('Twilio credentials not configured');
  }

  const url = `${TWILIO_API_BASE}/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const params = new URLSearchParams();
  params.append('From', TWILIO_WHATSAPP_NUMBER);
  params.append('To', to);
  params.append('Body', body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': getTwilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio send failed (${response.status}): ${errorBody}`);
  }

  return response.json();
};

/**
 * Download media from a Twilio media URL and convert to base64 data URI.
 * Twilio media URLs require authentication.
 * @param {string} mediaUrl - Twilio media URL
 * @returns {{ data: string, mimeType: string, size: number }}
 */
export const downloadMedia = async (mediaUrl) => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured');
  }

  const response = await fetch(mediaUrl, {
    headers: { 'Authorization': getTwilioAuthHeader() },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Media download failed (${response.status})`);
  }

  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());

  // Enforce 7.5MB limit (matching existing attachment validation)
  if (buffer.length > 7_500_000) {
    throw new Error('Media file too large (max 7.5MB)');
  }

  const base64 = buffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64}`;

  return { data: dataUri, mimeType, size: buffer.length };
};

/**
 * Validate Twilio webhook request signature.
 * Uses the X-Twilio-Signature header to verify the request came from Twilio.
 * @param {string} url - The full request URL (including protocol, host, path)
 * @param {object} params - The POST body parameters
 * @param {string} signature - The X-Twilio-Signature header value
 * @returns {boolean}
 */
export const validateWebhookSignature = (url, params, signature) => {
  if (!TWILIO_AUTH_TOKEN || !signature) return false;

  // Build the data string: URL + sorted POST params
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
};

/**
 * Normalize a phone number to E.164 format for consistent Firestore keys.
 * Strips the 'whatsapp:' prefix if present.
 * @param {string} phone - Phone number (e.g., 'whatsapp:+14155238886' or '+14155238886')
 * @returns {string} Normalized phone number (e.g., '+14155238886')
 */
export const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Strip whatsapp: prefix
  let normalized = phone.replace(/^whatsapp:/, '');
  // Strip all non-digit characters except leading +
  normalized = normalized.replace(/(?!^\+)[^\d]/g, '');
  return normalized;
};

/**
 * Check if Twilio is configured (all required env vars present).
 */
export const isTwilioConfigured = () => {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER);
};
