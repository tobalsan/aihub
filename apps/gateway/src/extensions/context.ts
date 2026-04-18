import type {
  Extension,
  ExtensionContext,
  AgentStreamEvent,
  AgentHistoryEvent,
  ProjectFileChangedEvent,
  ProjectAgentChangedEvent,
} from "@aihub/shared";
import {
  CONFIG_DIR,
  getAgent,
  getActiveAgents as getAgents,
  isAgentActive,
  getSubagentTemplates,
  resolveWorkspaceDir,
} from "../config/index.js";
import { runAgent, agentEventBus } from "../agents/index.js";
import { getAllSessionsForAgent } from "../agents/sessions.js";
import {
  resolveSessionId,
  getSessionEntry,
  clearSessionEntry,
  restoreSessionUpdatedAt,
} from "../sessions/index.js";
import { deleteSession } from "../agents/sessions.js";
import { invalidateResolvedHistoryFile } from "../history/store.js";
import { getSessionHistory } from "../agents/runner.js";
import type { GatewayConfig } from "@aihub/shared";

export function createExtensionContext(
  resolvedConfig: GatewayConfig
): Parameters<Extension["start"]>[0] {
  return {
    getConfig: () => resolvedConfig,
    getDataDir: () => CONFIG_DIR,
    getAgent,
    getAgents,
    isAgentActive,
    isAgentStreaming: (agentId: string) =>
      getAllSessionsForAgent(agentId).some((session) => session.isStreaming),
    resolveWorkspaceDir: (agent) => resolveWorkspaceDir(agent.workspace),
    runAgent,
    getSubagentTemplates,
    resolveSessionId: async (agentId: string, sessionKey: string) =>
      getSessionEntry(agentId, sessionKey),
    getSessionEntry,
    clearSessionEntry,
    restoreSessionUpdatedAt: (
      agentId: string,
      sessionKey: string,
      timestamp: number
    ) => {
      void restoreSessionUpdatedAt(agentId, sessionKey, timestamp);
    },
    deleteSession: (agentId: string, sessionId: string) => {
      void deleteSession(agentId, sessionId);
    },
    invalidateHistoryCache: async (
      agentId: string,
      sessionId: string,
      userId?: string
    ) => {
      invalidateResolvedHistoryFile(agentId, sessionId, userId);
    },
    getSessionHistory: (agentId: string, sessionId: string) =>
      getSessionHistory(agentId, sessionId),
    subscribe: (event: string, handler: (payload: unknown) => void) => {
      switch (event) {
        case "agent.stream":
          return agentEventBus.onStreamEvent(
            handler as Parameters<typeof agentEventBus.onStreamEvent>[0]
          );
        case "agent.history":
          return agentEventBus.onHistoryEvent(
            handler as Parameters<typeof agentEventBus.onHistoryEvent>[0]
          );
        case "agent.changed":
          return agentEventBus.onAgentChanged(
            handler as Parameters<typeof agentEventBus.onAgentChanged>[0]
          );
        case "file.changed":
          return agentEventBus.onFileChanged(
            handler as Parameters<typeof agentEventBus.onFileChanged>[0]
          );
        default: {
          agentEventBus.on(event, handler);
          return () => agentEventBus.off(event, handler);
        }
      }
    },
    emit: (event: string, payload: unknown) => {
      switch (event) {
        case "agent.stream":
          agentEventBus.emitStreamEvent(payload as AgentStreamEvent);
          break;
        case "agent.history":
          agentEventBus.emitHistoryEvent(payload as AgentHistoryEvent);
          break;
        case "agent.changed":
          agentEventBus.emitAgentChanged(payload as ProjectAgentChangedEvent);
          break;
        case "file.changed":
          agentEventBus.emitFileChanged(payload as ProjectFileChangedEvent);
          break;
        default:
          agentEventBus.emit(event, payload);
          break;
      }
    },
    logger: {
      info: (...args: unknown[]) => console.log(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      error: (...args: unknown[]) => console.error(...args),
    },
  } satisfies ExtensionContext;
}
