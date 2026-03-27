/**
 * Shared Gemini API call utility with timeout handling and model fallback.
 *
 * Eliminates duplicated AbortController + setTimeout patterns that were
 * repeated ~15 times across route handlers.
 */

/**
 * Calls the Gemini API with an automatic abort timeout.
 * Handles the AbortController lifecycle so callers don't have to.
 *
 * @param {object} ai - GoogleGenAI instance
 * @param {string} model - Model name (e.g. 'gemini-3-flash-preview')
 * @param {Array} contents - Gemini contents array
 * @param {object} config - Gemini config (systemInstruction, responseSchema, etc.)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {object} [requestOptions] - Additional request options (merged with signal)
 * @returns {Promise<string>} Raw response text
 */
export async function callGemini(ai, model, contents, config, timeoutMs, requestOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config,
      requestOptions: { ...requestOptions, signal: controller.signal },
    });
    return response.text || '{}';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls the Gemini API with automatic fallback to an alternate model.
 * If the primary model fails, retries with the fallback model using the
 * same (or optionally different) config.
 *
 * @param {object} options
 * @param {object} options.ai - GoogleGenAI instance
 * @param {string} options.primaryModel - Primary model name
 * @param {string} options.fallbackModel - Fallback model name
 * @param {Array} options.contents - Gemini contents array
 * @param {object} options.config - Gemini config for primary call
 * @param {number} options.timeoutMs - Timeout per attempt
 * @param {object} [options.fallbackConfig] - Optional different config for fallback (defaults to primary config)
 * @param {string} [options.label] - Log label for error messages (e.g. '[Enrich]')
 * @param {string} [options.requestId] - Request ID for log correlation
 * @returns {Promise<string>} Raw response text from whichever model succeeded
 */
export async function callGeminiWithFallback({
  ai, primaryModel, fallbackModel, contents, config,
  timeoutMs, fallbackConfig, label = '', requestId = '',
}) {
  try {
    return await callGemini(ai, primaryModel, contents, config, timeoutMs);
  } catch (primaryError) {
    const prefix = label ? `${label} ` : '';
    const rid = requestId ? `[${requestId}] ` : '';
    console.warn(`${prefix}${rid}Primary model failed: ${primaryError.message}. Trying fallback…`);

    return await callGemini(
      ai, fallbackModel, contents, fallbackConfig || config, timeoutMs
    );
  }
}
