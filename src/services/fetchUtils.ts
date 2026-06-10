/**
 * Shared fetch utilities — single source of truth for API_BASE, timeout, and JSON requests.
 * All service modules should import from here instead of declaring their own constants.
 */

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
export const DEFAULT_TIMEOUT = 10000;

/**
 * Typed JSON fetch helper with timeout, error unwrapping, and success checking.
 * Expects backend response shape: `{ success: boolean, data?: T, error?: string, detail?: string }`.
 */
export async function fetchJSON<T>(
  url: string,
  options?: RequestInit,
  timeout = DEFAULT_TIMEOUT,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error('Request timeout')),
    timeout,
  );
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Construct PDF preview URL for a given DOI.
 */
export function getPdfUrl(doi: string): string {
  return `${API_BASE}/api/pdf/${encodeURIComponent(doi)}`;
}
