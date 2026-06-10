/**
 * Multi-Document Chat API service — cross-project literature Q&A.
 */

import type { ChatSession, ChatMessage } from '../types';
import { API_BASE, DEFAULT_TIMEOUT } from './fetchUtils';
import { createSSEStream } from './sse';

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
  return createSSEStream<ChatSSEEvent>({
    url: '/api/chat',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        question,
        context_dois: contextDois.length > 0 ? contextDois : null,
      }),
    },
    onEvent,
    onError,
    isTerminal: (event) => event.type === 'done' || event.type === 'error',
    errorLabel: 'Chat',
  });
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
