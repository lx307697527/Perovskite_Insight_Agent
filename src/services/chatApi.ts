/**
 * Multi-Document Chat API service — cross-project literature Q&A.
 * Follows the same SSE streaming pattern as qaApi.ts.
 */

import type { ChatSession, ChatMessage } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEFAULT_TIMEOUT = 10000;

export interface ChatSSEEvent {
  type: 'content' | 'source' | 'done' | 'error';
  text?: string;
  doi?: string;
  page?: number;
  excerpt?: string;
  file?: string;
  section?: string;
  relevance?: number;
  title?: string;
  session_id?: string;
  cost?: number;
  tokens?: number;
  message?: string;
  timestamp: string;
}

export interface ChatSessionDetail extends ChatSession {
  messages: ChatMessage[];
}

/**
 * Create a multi-doc chat SSE connection (POST-based streaming).
 * Returns a cleanup function to close the connection.
 */
export function createChatConnection(
  projectId: string,
  question: string,
  contextDois: string[],
  onEvent: (event: ChatSSEEvent) => void,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController();
  let closed = false;

  const startStream = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          question,
          context_dois: contextDois.length > 0 ? contextDois : null,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed: ${resp.statusText}`);
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
              const event = JSON.parse(line.slice(6)) as ChatSSEEvent;
              onEvent(event);
              if (event.type === 'done' || event.type === 'error') {
                closed = true;
                return;
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        onError(err instanceof Error ? err : new Error('Chat connection failed'));
      }
    }
  };

  startStream();

  return () => {
    closed = true;
    controller.abort();
  };
}

export async function listChatSessions(projectId: string): Promise<ChatSession[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(
      `${API_BASE}/api/chat/sessions?project_id=${encodeURIComponent(projectId)}`,
      { signal: controller.signal },
    );
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed to list sessions');
    return data.data as ChatSession[];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getChatSession(sessionId: string): Promise<ChatSessionDetail> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed to get session');
    return data.data as ChatSessionDetail;
  } finally {
    clearTimeout(timeoutId);
  }
}
