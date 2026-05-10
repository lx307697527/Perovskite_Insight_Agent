import type { Project, Literature } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 30000;

async function fetchJSON<T>(url: string, options?: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ProjectWithStats extends Project {
  literature_count: number;
  extracted_count: number;
}

export interface ProjectDetail extends ProjectWithStats {
  literature: Literature[];
}

export async function listProjects(): Promise<ProjectWithStats[]> {
  return fetchJSON<ProjectWithStats[]>(`${API_BASE}/api/projects`);
}

export async function createProject(name: string, description?: string, domain?: string): Promise<Project> {
  return fetchJSON<Project>(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, domain }),
  });
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  return fetchJSON<ProjectDetail>(`${API_BASE}/api/projects/${projectId}`);
}

export async function updateProject(projectId: string, updates: Partial<Pick<Project, 'name' | 'description' | 'domain'>>): Promise<Project> {
  return fetchJSON<Project>(`${API_BASE}/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteProject(projectId: string): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/projects/${projectId}`, { method: 'DELETE' });
}

export async function assignLiteratureToProject(projectId: string, dois: string[]): Promise<{ message: string; updated_count: number }> {
  return fetchJSON(`${API_BASE}/api/projects/${projectId}/literature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dois }),
  });
}
