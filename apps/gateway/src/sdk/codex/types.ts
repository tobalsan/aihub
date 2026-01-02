// Type stubs for @openai/codex-sdk
// These allow TypeScript to compile without the package installed

export type ThreadOptions = {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
};

export type CodexItem = {
  id: string;
  type: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  content?: string;
  status?: string;
};

export type CodexEvent =
  | { type: "thread.started" }
  | { type: "turn.started" }
  | { type: "item.started"; item: CodexItem }
  | { type: "item.completed"; item: CodexItem }
  | {
      type: "turn.completed";
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    }
  | { type: "turn.failed"; error?: string }
  | { type: "error"; error?: string };

export type Thread = {
  id: string;
  run(message: string): Promise<{ finalResponse: string; items: unknown[] }>;
  runStreamed(message: string): Promise<{ events: AsyncGenerator<CodexEvent, void> }>;
};

export type Codex = {
  startThread(options?: ThreadOptions): Thread;
  resumeThread(id: string, options?: ThreadOptions): Thread;
};
