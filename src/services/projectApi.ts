import type { Project, Literature } from '../types';
import { API_BASE, fetchJSON } from './fetchUtils';

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
