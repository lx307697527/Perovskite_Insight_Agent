/**
 * Generic SSE streaming utility — shared by qaApi, chatApi, and extractApi.
 * Uses POST-based fetch + ReadableStream + TextDecoder (NOT native EventSource).
 * Returns a cleanup function that aborts the stream.
 */

import { API_BASE } from './fetchUtils';

export interface SSEStreamConfig<T> {
  /** URL path relative to API_BASE (e.g. '/api/qa/10.1234/...') */
  url: string;
  /** Fetch options (method, headers, body) */
  init: RequestInit;
  /** Called for each parsed SSE event */
  onEvent: (event: T) => void;
  /** Called on connection error (network failure, non-OK response) */
  onError: (error: Error) => void;
  /** Return true when the stream should stop (terminal event detected) */
  isTerminal: (event: T) => boolean;
  /** Label for error messages (e.g. 'Q&A', 'Stage1 extraction') */
  errorLabel?: string;
}

/**
 * Opens a POST-based SSE stream and returns a cleanup function.
 * The stream starts immediately (async, fire-and-forget).
 */
export function createSSEStream<T>(config: SSEStreamConfig<T>): () => void {
  const controller = new AbortController();
  let closed = false;
  const label = config.errorLabel || 'SSE';

  const startStream = async () => {
    try {
      const resp = await fetch(`${API_BASE}${config.url}`, {
        ...config.init,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `${label} request failed: ${resp.statusText}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as T;
              config.onEvent(event);
              if (config.isTerminal(event)) {
                closed = true;
                return;
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        config.onError(
          err instanceof Error ? err : new Error(`${label} connection failed`),
        );
      }
    }
  };

  startStream();

  return () => {
    closed = true;
    controller.abort();
  };
}
