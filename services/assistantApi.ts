/**
 * assistantApi.ts
 *
 * Calls to the assistant endpoints that can be cancelled by the user and that
 * report the server's error code, so callers can react to specific failures.
 */
import { postProxy } from './proxyService';

export class AssistantCancelledError extends Error {
  constructor() {
    super('Assistant request cancelled');
    this.name = 'AssistantCancelledError';
  }
}

/** A non-2xx reply from an assistant endpoint. */
export class AssistantApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string | null) {
    super(message);
    this.name = 'AssistantApiError';
  }
}

/**
 * POST to an assistant endpoint. Throws AssistantCancelledError when `signal`
 * aborts, AssistantApiError otherwise (timeouts included, with no status).
 */
export const postAssistant = async <T>(
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> => {
  // postProxy only applies its own timeout when no signal is passed, so
  // combine the caller's cancel signal and the timeout here.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    if (signal?.aborted) throw new AssistantCancelledError();
    return await postProxy<T>(path, body, { signal: controller.signal });
  } catch (e) {
    if (e instanceof AssistantCancelledError || signal?.aborted) throw new AssistantCancelledError();
    const message = e instanceof Error ? e.message : String(e);
    // postProxy reports failures as "Proxy error <status>: <body>".
    const status = /^Proxy error (\d{3}):/.exec(message);
    const code = /"code"\s*:\s*"([a-z_]+)"/.exec(message);
    throw new AssistantApiError(message, status ? Number(status[1]) : null, code ? code[1] : null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};
