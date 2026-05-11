/**
 * Comparison & Export API service — condition filtering, quality warnings, multi-format export.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 30000;

export interface ComparisonFilters {
  scan_direction?: string;
  min_active_area?: number;
  has_spo?: boolean;
  isos_protocol?: string;
  year_start?: number;
  year_end?: number;
  view_mode?: 'metrics' | 'literature';
}

export interface QualityWarning {
  reason: string;
  severity: 'warning' | 'missing';
}

export interface ComparisonData {
  columns: string[];
  rows: Record<string, string>[];
  quality_warnings: Record<string, Record<string, QualityWarning>>;
  total: number;
  filtered: number;
  view_mode: string;
}

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

/**
 * Get comparison data for a project with optional condition filtering.
 */
export async function getComparisonData(
  projectId: string,
  filters?: ComparisonFilters,
): Promise<ComparisonData> {
  const params = new URLSearchParams();
  if (filters) {
    if (filters.scan_direction) params.set('scan_direction', filters.scan_direction);
    if (filters.min_active_area !== undefined) params.set('min_active_area', String(filters.min_active_area));
    if (filters.has_spo !== undefined) params.set('has_spo', String(filters.has_spo));
    if (filters.isos_protocol) params.set('isos_protocol', filters.isos_protocol);
    if (filters.year_start) params.set('year_start', String(filters.year_start));
    if (filters.year_end) params.set('year_end', String(filters.year_end));
    if (filters.view_mode) params.set('view_mode', filters.view_mode);
  }

  const qs = params.toString();
  const url = `${API_BASE}/api/project/${encodeURIComponent(projectId)}/compare${qs ? '?' + qs : ''}`;
  return fetchJSON<ComparisonData>(url);
}

/**
 * Export comparison data in the specified format. Returns a Blob for download.
 */
export async function exportComparison(
  projectId: string,
  format: 'excel' | 'csv' | 'latex' | 'png',
  dois?: string[],
  viewMode?: string,
): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // Longer timeout for exports

  try {
    const resp = await fetch(`${API_BASE}/api/project/${encodeURIComponent(projectId)}/compare/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, dois, view_mode: viewMode || 'metrics' }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Export failed: ${resp.statusText}`);
    }

    return await resp.blob();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper: Trigger browser download of a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
