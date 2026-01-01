export type Agent = {
  id: string;
  name: string;
  model: {
    provider: string;
    model: string;
  };
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type SendMessageResponse = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
  };
};
