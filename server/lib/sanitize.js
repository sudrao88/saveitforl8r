/**
 * Shared sanitization utilities used across middleware and services.
 */

/** Strip C0+C1 control chars (keeping \n, \t, \r) and limit excessive newlines. */
export const sanitizeUserInput = (input) => {
  if (!input) return '';
  const str = typeof input === 'string' ? input : String(input);
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n');
};

/** Strip HTML tags and control characters from an LLM-generated string. */
export const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
};

/**
 * Sanitize AI-generated strings before embedding in downstream prompts.
 * Strips control characters and truncates to prevent prompt injection.
 */
export const sanitizeForPromptEmbedding = (str, maxLength = 200) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/[`$\\]/g, '')
    .trim()
    .slice(0, maxLength);
};

/** Parse JSON from model text response (handles markdown fences). */
export const parseJsonResponse = (raw) => {
  let jsonString = raw || '{}';
  jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(jsonString);
};
