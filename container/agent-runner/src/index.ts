import { pathToFileURL } from "node:url";
import {
  ContainerInputSchema,
  ContainerOutputSchema,
  type ContainerInput,
  type ContainerOutput,
} from "@aihub/shared";
import { startIpcPoller, type IpcCleanup } from "./ipc.js";
import { configureProxy, type ConnectorHttpClient } from "./proxy.js";
import { runAgent } from "./runner.js";

export const OUTPUT_START = "---AIHUB_OUTPUT_START---";
export const OUTPUT_END = "---AIHUB_OUTPUT_END---";

export let proxyClient: ConnectorHttpClient = configureProxy();

type AgentRunnerDeps = {
  readStdin?: () => Promise<string>;
  writeStdout?: (chunk: string) => void;
  writeStderr?: (chunk: string) => void;
  runAgent?: (input: ContainerInput) => Promise<ContainerOutput>;
  startIpcPoller?: typeof startIpcPoller;
};

export async function runAgentRunner(
  deps: AgentRunnerDeps = {}
): Promise<void> {
  const read = deps.readStdin ?? readStdin;
  const writeStdout =
    deps.writeStdout ?? ((chunk) => process.stdout.write(chunk));
  const writeStderr =
    deps.writeStderr ?? ((chunk) => process.stderr.write(chunk));
  const run = deps.runAgent ?? runAgent;
  const startPoller = deps.startIpcPoller ?? startIpcPoller;

  const input = parseInput(await read());
  proxyClient = configureProxy(input.onecli);
  configureSdkBaseUrls(input.onecli);
  let cleanup: IpcCleanup | undefined;

  try {
    cleanup = startPoller(
      input.ipcDir,
      (message) => {
        writeStderr(
          `[agent-runner] Received follow-up IPC message ${JSON.stringify(
            message
          )}\n`
        );
      },
      () => {
        writeStderr("[agent-runner] Received close IPC sentinel\n");
      }
    );

    const output = ContainerOutputSchema.parse(await run(input));
    writeProtocolOutput(output, writeStdout);
  } finally {
    cleanup?.();
  }
}

export function writeProtocolOutput(
  output: ContainerOutput,
  writeStdout: (chunk: string) => void = (chunk) => process.stdout.write(chunk)
): void {
  writeStdout(`${OUTPUT_START}\n`);
  writeStdout(`${JSON.stringify(output)}\n`);
  writeStdout(`${OUTPUT_END}\n`);
}

function parseInput(raw: string): ContainerInput {
  return ContainerInputSchema.parse(JSON.parse(raw));
}

function configureSdkBaseUrls(onecli: ContainerInput["onecli"]): void {
  if (!onecli?.enabled) return;

  process.env.ANTHROPIC_BASE_URL ??= onecli.url;
  process.env.OPENAI_BASE_URL ??= `${onecli.url.replace(/\/$/, "")}/v1`;
}

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAgentRunner().catch((error: unknown) => {
    console.error("[agent-runner] Fatal error", error);
    writeProtocolOutput({
      text: "",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
