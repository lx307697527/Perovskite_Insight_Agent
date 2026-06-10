import type { SSEEvent } from '../types';
import { API_BASE, DEFAULT_TIMEOUT } from './fetchUtils';
import { createSSEStream } from './sse';

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
 * Create Stage1 SSE connection (POST-based streaming).
 */
export function createStage1Connection(
  doi: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  return createSSEStream<SSEEvent>({
    url: `/api/extract/${encodeURIComponent(doi)}/stage1`,
    init: { method: 'POST' },
    onEvent,
    onError,
    isTerminal: (data) => data.status === 'completed' || data.status === 'failed' || data.status === 'cached',
    errorLabel: 'Stage1 extraction',
  });
}

/**
 * Create Stage2 deep extraction SSE connection.
 */
export function createDeepExtractionConnection(
  doi: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  return createSSEStream<SSEEvent>({
    url: `/api/extract/${encodeURIComponent(doi)}/deep`,
    init: { method: 'POST' },
    onEvent,
    onError,
    isTerminal: (data) => data.status === 'completed' || data.status === 'failed' || data.status === 'cached',
    errorLabel: 'Deep extraction',
  });
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
  try {
    const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/cancel`, {
      method: 'POST',
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Cancel failed');
  } catch (error) {
    console.error('Cancel extraction error:', error);
    throw error;
  }
}

/**
 * Start extraction for a DOI (triggers Stage1 extraction).
 */
export async function startExtraction(doi: string): Promise<void> {
  try {
    const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/stage1`, {
      method: 'POST',
    });
    const data = await resp.json().catch(() => ({}));
    // If response is not OK but not a stream, throw error
    if (!resp.ok && !resp.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error(data.detail || data.error || 'Failed to start extraction');
    }
  } catch (error) {
    console.error('Start extraction error:', error);
    throw error;
  }
}
