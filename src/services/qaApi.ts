import type { QASSEEvent, QuickQuestion } from '../types';
import { API_BASE, DEFAULT_TIMEOUT } from './fetchUtils';
import { createSSEStream } from './sse';

export async function getQASuggestions(doi: string): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(`${API_BASE}/api/qa/${encodeURIComponent(doi)}/suggestions`, {
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed to get suggestions');
    return data.data as string[];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getQAHistory(doi: string): Promise<QuickQuestion[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(`${API_BASE}/api/qa/${encodeURIComponent(doi)}/history`, {
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed to get history');
    return data.data as QuickQuestion[];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a Q&A SSE connection (POST-based streaming).
 * Returns a cleanup function to close the connection.
 */
export function createQAConnection(
  doi: string,
  question: string,
  onEvent: (event: QASSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  return createSSEStream<QASSEEvent>({
    url: `/api/qa/${encodeURIComponent(doi)}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    },
    onEvent,
    onError,
    isTerminal: (event) => event.type === 'done' || event.type === 'error',
    errorLabel: 'Q&A',
  });
}
