import type { ConfigStatus, DomainType, Settings } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 10000;

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

export interface AIEnginePayload {
  apiKey: string;
  baseUrl: string;
  model: string;
  stage1Model?: string;
  stage2Model?: string;
}

export interface ProxyPayload {
  proxyUrl?: string;
  cookieHeader?: string;
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  return fetchJSON<ConfigStatus>(`${API_BASE}/api/config/status`);
}

export async function saveAIEngine(payload: AIEnginePayload): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/config/ai-engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function testConnectivity(payload: AIEnginePayload): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/config/test-connectivity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function saveProxy(payload: ProxyPayload): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/config/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateDomains(domain: DomainType): Promise<{ message: string; domain: string }> {
  return fetchJSON<{ message: string; domain: string }>(`${API_BASE}/api/config/domains`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  });
}

export async function verifyEmbedding(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${API_BASE}/api/config/embedding/verify`, { method: 'POST' });
}

export async function getCacheStats(): Promise<{
  total_papers: number;
  extracted_count: number;
  cache_size_mb: number;
  pdf_count: number;
  oldest_file_date: string | null;
  index_size_mb: number;
}> {
  return fetchJSON(`${API_BASE}/api/config/cache`);
}

export async function clearCache(): Promise<{ message: string }> {
  return fetchJSON<{ message: string }>(`${API_BASE}/api/config/cache`, { method: 'DELETE' });
}

export async function clearExpiredCache(olderThanDays: number): Promise<{ message: string; removed_count: number }> {
  return fetchJSON<{ message: string; removed_count: number }>(`${API_BASE}/api/config/cache/expired`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ older_than_days: olderThanDays }),
  });
}

export async function updateDomainsMulti(domains: string[]): Promise<{ message: string; domains: string[] }> {
  return fetchJSON<{ message: string; domains: string[] }>(`${API_BASE}/api/config/domains/multi`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains }),
  });
}
