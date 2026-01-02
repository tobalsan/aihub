export type AgentSession = {
  agentId: string;
  sessionId: string;
  isStreaming: boolean;
  lastActivity: number;
  abortController?: AbortController;
  sessionHandle?: unknown; // SDK-agnostic session handle
  pendingMessages: string[];
  pendingUserMessages: Array<{ text: string; timestamp: number }>;
};

const sessions = new Map<string, AgentSession>();

export function getSession(agentId: string, sessionId: string): AgentSession | undefined {
  return sessions.get(`${agentId}:${sessionId}`);
}

export function getOrCreateSession(agentId: string, sessionId: string): AgentSession {
  const key = `${agentId}:${sessionId}`;
  let session = sessions.get(key);
  if (!session) {
    session = {
      agentId,
      sessionId,
      isStreaming: false,
      lastActivity: Date.now(),
      pendingMessages: [],
      pendingUserMessages: [],
    };
    sessions.set(key, session);
  }
  return session;
}

/** Buffer a message to be queued once session handle is available */
export function bufferPendingMessage(agentId: string, sessionId: string, message: string) {
  const session = getOrCreateSession(agentId, sessionId);
  session.pendingMessages.push(message);
}

/** Get and clear pending messages */
export function popPendingMessages(agentId: string, sessionId: string): string[] {
  const session = getSession(agentId, sessionId);
  if (!session) return [];
  const messages = session.pendingMessages;
  session.pendingMessages = [];
  return messages;
}

export function enqueuePendingUserMessage(
  agentId: string,
  sessionId: string,
  text: string,
  timestamp: number
) {
  const session = getOrCreateSession(agentId, sessionId);
  session.pendingUserMessages.push({ text, timestamp });
}

export function shiftPendingUserMessage(
  agentId: string,
  sessionId: string
): { text: string; timestamp: number } | undefined {
  const session = getSession(agentId, sessionId);
  if (!session || session.pendingUserMessages.length === 0) return undefined;
  return session.pendingUserMessages.shift();
}

export function popAllPendingUserMessages(
  agentId: string,
  sessionId: string
): Array<{ text: string; timestamp: number }> {
  const session = getSession(agentId, sessionId);
  if (!session) return [];
  const pending = session.pendingUserMessages;
  session.pendingUserMessages = [];
  return pending;
}

export function setSessionStreaming(
  agentId: string,
  sessionId: string,
  streaming: boolean,
  abortController?: AbortController
) {
  const session = getOrCreateSession(agentId, sessionId);
  session.isStreaming = streaming;
  session.lastActivity = Date.now();
  session.abortController = streaming ? abortController : undefined;
}

export function isStreaming(agentId: string, sessionId: string): boolean {
  const session = getSession(agentId, sessionId);
  return session?.isStreaming ?? false;
}

export function abortSession(agentId: string, sessionId: string): boolean {
  const session = getSession(agentId, sessionId);
  if (!session?.abortController) return false;
  session.abortController.abort();
  return true;
}

export function setSessionHandle(
  agentId: string,
  sessionId: string,
  handle: unknown
) {
  const session = getOrCreateSession(agentId, sessionId);
  session.sessionHandle = handle;
}

export function getSessionHandle(
  agentId: string,
  sessionId: string
): unknown | undefined {
  const session = getSession(agentId, sessionId);
  return session?.sessionHandle;
}

export function clearSessionHandle(agentId: string, sessionId: string) {
  const session = getSession(agentId, sessionId);
  if (session) {
    session.sessionHandle = undefined;
  }
}

export function getAllSessionsForAgent(agentId: string): AgentSession[] {
  const result: AgentSession[] = [];
  for (const [key, session] of sessions) {
    if (key.startsWith(`${agentId}:`)) {
      result.push(session);
    }
  }
  return result;
}
