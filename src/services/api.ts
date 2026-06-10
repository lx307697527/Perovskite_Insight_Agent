/**
 * Legacy V1 API service — retained functions still used by pages.
 * New code should use the V2 service modules (literatureApi, configApi, etc.).
 */

import type { ApiResponse, SearchResponse, PaperDetailsResponse, Settings, SSEEvent, Paper } from '../types';
import { API_BASE, DEFAULT_TIMEOUT } from './fetchUtils';

/**
 * Helper function to create a fetch request with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Search papers by query
 * @deprecated V1 legacy — use literatureApi.addLiterature() for keyword input
 */
export async function searchPapers(query: string, filters?: Record<string, unknown>): Promise<SearchResponse> {
  try {
    let url = `${API_BASE}/api/search?query=${encodeURIComponent(query)}`;
    if (filters) {
      if (filters.yearStart) url += `&year_start=${filters.yearStart}`;
      if (filters.yearEnd) url += `&year_end=${filters.yearEnd}`;
      if (filters.minPce) url += `&min_pce=${filters.minPce}`;
    }

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    const data: ApiResponse<SearchResponse> = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Search failed');
    }

    return data.data!;
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

/**
 * Fetch paper details by DOI
 * @deprecated V1 legacy — use literatureApi.getLiterature() for V2
 */
export async function fetchPaperDetails(doi: string): Promise<PaperDetailsResponse> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/paper/${encodeURIComponent(doi)}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch paper: ${response.statusText}`);
    }

    const data: ApiResponse<PaperDetailsResponse> = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch paper');
    }

    return data.data!;
  } catch (error) {
    console.error('Fetch paper error:', error);
    throw error;
  }
}

/**
 * Create SSE connection for extraction (V1 EventSource-based).
 * Retained — DetailsPage and ResultsPage still use V1 SSE endpoints.
 */
export function createExtractionConnection(doi: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract/${encodeURIComponent(doi)}`);
}

/**
 * Create SSE connection for local file extraction (V1 EventSource-based).
 */
export function createLocalExtractionConnection(path: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract_local?path=${encodeURIComponent(path)}`);
}

/**
 * Create SSE connection for uploaded file extraction status.
 * Uses the V1 proxy which resolves upload_ DOIs to local PDF paths.
 */
export function createUploadExtractionConnection(uploadId: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract/${encodeURIComponent(uploadId)}`);
}

export async function clearAllHistory(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/history/clear`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to clear history');
  } catch (error) {
    console.error('Clear history error:', error);
    throw error;
  }
}

/**
 * Translate text using AI
 */
export async function translateText(text: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await response.json();
    if (data.success) return data.data;
    throw new Error(data.error || 'Translation failed');
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}
