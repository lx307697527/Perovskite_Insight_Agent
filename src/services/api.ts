import type { ApiResponse, SearchResponse, PaperDetailsResponse, Settings, SSEEvent, Paper } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 30000; // 30 seconds

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
export async function searchPapers(query: string, filters?: any): Promise<SearchResponse> {
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
 * Fetch extraction history
 * @deprecated V1 legacy — use literatureApi.listInbox() + projectApi.getProject() for V2
 */
export async function fetchExtractionHistory(): Promise<Paper[]> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/history`);

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.statusText}`);
    }

    const data: ApiResponse<Paper[]> = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch history');
    }

    return data.data!;
  } catch (error) {
    console.error('Fetch history error:', error);
    throw error;
  }
}

/**
 * Save settings to backend
 * @deprecated V1 legacy — use configApi.saveAIEngine() for V2
 */
export async function saveSettings(config: Settings): Promise<void> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to save settings: ${response.statusText}`);
    }

    const data: ApiResponse = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to save settings');
    }
  } catch (error) {
    console.error('Save settings error:', error);
    throw error;
  }
}

/**
 * Create SSE connection for extraction
 * @deprecated V1 legacy — use extractApi.createDeepExtractionConnection() for V2
 */
export function createExtractionConnection(doi: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract/${encodeURIComponent(doi)}`);
}

/**
 * Create SSE connection for local file extraction
 * @deprecated V1 legacy — use extractApi for V2
 */
export function createLocalExtractionConnection(path: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract_local?path=${encodeURIComponent(path)}`);
}

/**
 * Create SSE connection for uploaded file extraction status
 */
export function createUploadExtractionConnection(uploadId: string): EventSource {
  return new EventSource(`${API_BASE}/api/extract_upload/status/${uploadId}`);
}

/**
 * Upload a PDF file and get extraction via SSE
 * @deprecated V1 legacy — use literatureApi.uploadLiterature() + extractApi for V2
 */
export async function uploadPdfForExtraction(file: File): Promise<{ doi: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetchWithTimeout(`${API_BASE}/api/extract_upload`, {
    method: 'POST',
    body: formData
  }, 60000); // 60 second timeout for upload

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Upload failed');
  }

  // The SSE connection will be created by the ResultsPage component
  const doi = data.data.doi;

  return { doi };
}

/**
 * Export papers to Excel
 * @deprecated V1 legacy — use compareApi.exportComparison() for V2
 */
export function getExportUrl(dois: string[]): string {
  return `${API_BASE}/api/export/excel?dois=${dois.join(',')}`;
}

/**
 * Get PDF preview URL
 */
export function getPdfUrl(doi: string): string {
  return `${API_BASE}/api/pdf/${encodeURIComponent(doi)}`;
}

export async function clearAllHistory(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/history/clear`, {
    method: 'DELETE'
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Failed to clear history');
}

/**
 * Translate text using AI
 */
export async function translateText(text: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await response.json();
  if (data.success) return data.data;
  throw new Error(data.error || 'Translation failed');
}
