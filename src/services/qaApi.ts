import type { QASSEEvent, QuickQuestion } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 10000;

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
  const controller = new AbortController();
  let closed = false;

  const startStream = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/qa/${encodeURIComponent(doi)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed: ${resp.statusText}`);
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
              const event = JSON.parse(line.slice(6)) as QASSEEvent;
              onEvent(event);
              if (event.type === 'done' || event.type === 'error') {
                closed = true;
                return;
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        onError(err instanceof Error ? err : new Error('Q&A connection failed'));
      }
    }
  };

  startStream();

  return () => {
    closed = true;
    controller.abort();
  };
}
