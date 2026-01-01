import type { Agent, SendMessageResponse } from "./types";
export declare function fetchAgents(): Promise<Agent[]>;
export declare function sendMessage(agentId: string, message: string, sessionId?: string): Promise<SendMessageResponse>;
export declare function streamMessage(agentId: string, message: string, sessionId: string, onText: (text: string) => void, onDone: () => void, onError: (error: string) => void): () => void;
//# sourceMappingURL=client.d.ts.map