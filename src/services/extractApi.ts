import type { SSEEvent } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 30000;

export interface StageProgressInfo {
  progress: number;
  current_stage: string;
  current_label: string;
  stages: { name: string; label: string; weight: number; status: string }[];
  eta_seconds: number | null;
}

export interface ExtractionStatus {
  stage: string;
  progress: number;
  current_label?: string;
  eta_seconds?: number | null;
  is_extracted: boolean;
  relevance_score?: number | null;
  quality_flag?: string | null;
}

/**
 * Create Stage1 SSE connection (uses EventSource since it's a POST with SSE response).
 */
export function createStage1Connection(
  doi: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController();
  let closed = false;

  const startStream = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/stage1`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Stage1 request failed: ${resp.statusText}`);
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
              const data = JSON.parse(line.slice(6)) as SSEEvent;
              onEvent(data);
              if (data.status === 'completed' || data.status === 'failed' || data.status === 'cached') {
                closed = true;
                return;
              }
            } catch {
              // Skip malformed
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        onError(err instanceof Error ? err : new Error('Stage1 connection failed'));
      }
    }
  };

  startStream();
  return () => {
    closed = true;
    controller.abort();
  };
}

/**
 * Create Stage2 deep extraction SSE connection.
 */
export function createDeepExtractionConnection(
  doi: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController();
  let closed = false;

  const startStream = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/deep`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Deep extraction request failed: ${resp.statusText}`);
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
              const data = JSON.parse(line.slice(6)) as SSEEvent;
              onEvent(data);
              if (data.status === 'completed' || data.status === 'failed' || data.status === 'cached') {
                closed = true;
                return;
              }
            } catch {
              // Skip malformed
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        onError(err instanceof Error ? err : new Error('Deep extraction connection failed'));
      }
    }
  };

  startStream();
  return () => {
    closed = true;
    controller.abort();
  };
}

/**
 * Get current extraction status.
 */
export async function getExtractionStatus(doi: string): Promise<ExtractionStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/status`, {
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed to get status');
    return data.data as ExtractionStatus;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Cancel an ongoing extraction.
 */
export async function cancelExtraction(doi: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/cancel`, {
    method: 'POST',
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || 'Cancel failed');
}
