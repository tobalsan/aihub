import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";

export type AgentSession = {
  agentId: string;
  sessionId: string;
  isStreaming: boolean;
  lastActivity: number;
  abortController?: AbortController;
  piSession?: PiAgentSession;
  pendingMessages: string[];
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
    };
    sessions.set(key, session);
  }
  return session;
}

/** Buffer a message to be queued once Pi session is available */
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

export function setAgentSession(
  agentId: string,
  sessionId: string,
  piSession: PiAgentSession
) {
  const session = getOrCreateSession(agentId, sessionId);
  session.piSession = piSession;
}

export function getAgentSession(
  agentId: string,
  sessionId: string
): PiAgentSession | undefined {
  const session = getSession(agentId, sessionId);
  return session?.piSession;
}

export function clearAgentSession(agentId: string, sessionId: string) {
  const session = getSession(agentId, sessionId);
  if (session) {
    session.piSession = undefined;
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
