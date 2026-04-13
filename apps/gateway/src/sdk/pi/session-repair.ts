import type { AgentMessage } from "@mariozechner/pi-agent-core";

type AssistantMsg = AgentMessage & {
  role: "assistant";
  stopReason?: string;
  content?: Array<{ type: string; id?: string; name?: string }>;
};

/**
 * Repair an orphaned tool-use turn at the tail of the message history.
 *
 * When the gateway is killed mid-run, the Pi session file can end with an
 * assistant message that has stopReason "toolUse" but no corresponding
 * toolResult messages. Sending this to the LLM API is invalid (Anthropic
 * requires tool_result after tool_use).
 *
 * This function detects that condition and appends synthetic toolResult
 * messages so the conversation sequence is valid.
 */
export function repairOrphanedToolCalls(agentSession: {
  agent: { state: { messages: AgentMessage[] } };
}): void {
  const messages = agentSession.agent.state.messages;
  if (!messages || messages.length === 0) return;

  // Find the last assistant message
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return;

  const lastAssistant = messages[lastAssistantIdx] as AssistantMsg;

  // Only repair if stopReason is "toolUse"
  if (lastAssistant.stopReason !== "toolUse") return;

  // Check if there are already toolResult messages after this assistant message
  const hasToolResultAfter = messages
    .slice(lastAssistantIdx + 1)
    .some((m) => m.role === "toolResult");
  if (hasToolResultAfter) return;

  // Collect tool call IDs that need synthetic results
  const toolCalls = (lastAssistant.content ?? []).filter(
    (block) => block.type === "toolCall"
  ) as Array<{ id: string; name: string }>;

  if (toolCalls.length === 0) return;

  // Build synthetic toolResult messages
  const syntheticResults: AgentMessage[] = toolCalls.map((tc) => ({
    role: "toolResult",
    toolCallId: tc.id,
    toolName: tc.name,
    content: [
      {
        type: "text",
        text: "[Session interrupted — tool result unavailable. The gateway was restarted while this tool call was pending.]",
      },
    ],
    isError: true,
  } as AgentMessage));

  // Append after the orphaned assistant message
  agentSession.agent.state.messages = [
    ...messages.slice(0, lastAssistantIdx + 1),
    ...syntheticResults,
  ];
}
