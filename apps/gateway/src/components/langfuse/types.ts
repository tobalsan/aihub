export type SpanState = {
  span: unknown;
  id: string;
  name: string;
  input: unknown;
  startedAt: number;
};

export type GenerationState = {
  generation: unknown;
  openSpans: Map<string, SpanState>;
  output: string[];
  thinking: string[];
  model?: string;
  usage?: unknown;
  stopReason?: string;
  status?: "success" | "error";
};

export type TraceState = {
  trace: unknown;
  currentGeneration?: GenerationState;
  lastActivity: number;
};
