import type { Literature } from '../types';
import { API_BASE, fetchJSON } from './fetchUtils';

export interface AddResult {
  doi: string;
  type: 'doi' | 'pdf' | 'keyword';
  cached?: boolean;
  filename?: string;
  results?: Literature[];
  project_id?: string | null;
}

export async function addLiterature(input: string, projectId?: string | null): Promise<AddResult> {
  return fetchJSON<AddResult>(`${API_BASE}/api/literature/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, project_id: projectId }),
  });
}

export async function uploadLiterature(file: File, projectId?: string | null): Promise<{ doi: string; filename: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('上传超时')), 60000);
  try {
    const url = `${API_BASE}/api/literature/upload${projectId ? `?project_id=${projectId}` : ''}`;
    const resp = await fetch(url, { method: 'POST', body: formData, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || 'Upload failed');
    }
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    return data.data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('上传超时，请检查后端服务是否运行');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveDoi(doi: string, projectId?: string | null): Promise<{ doi: string; cached: boolean }> {
  return fetchJSON(`${API_BASE}/api/literature/doi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doi, project_id: projectId }),
  });
}

export async function deleteLiterature(doi: string): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/literature/${encodeURIComponent(doi)}`, {
    method: 'DELETE',
  });
}

export async function getLiterature(doi: string): Promise<Literature> {
  return fetchJSON<Literature>(`${API_BASE}/api/literature/${encodeURIComponent(doi)}`);
}

export async function listInbox(): Promise<Literature[]> {
  return fetchJSON<Literature[]>(`${API_BASE}/api/inbox`);
}

export async function moveFromInbox(doi: string, projectId: string): Promise<{ message: string }> {
  return fetchJSON(`${API_BASE}/api/inbox/${encodeURIComponent(doi)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });
}

/**
 * Start extraction for a literature item.
 */
export async function startExtraction(doi: string): Promise<void> {
  try {
    const resp = await fetch(`${API_BASE}/api/extract/${encodeURIComponent(doi)}/stage1`, {
      method: 'POST',
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !resp.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error(data.detail || data.error || 'Failed to start extraction');
    }
  } catch (error) {
    console.error('Start extraction error:', error);
    throw error;
  }
}
