import { Command } from "commander";
import { notify, type GatewayConfig, type NotifySummary } from "@aihub/shared";
import { loadConfig } from "../config/index.js";
import { resolveStartupConfig } from "../config/validate.js";

type NotifyCommandOptions = {
  channel?: string;
  message?: string;
  surface?: string;
  mention?: string;
};

type NotifyCommandDeps = {
  loadConfig?: () => GatewayConfig;
  resolveConfig?: (config: GatewayConfig) => Promise<GatewayConfig>;
  notifyImpl?: typeof notify;
};

function printNotifyResults(summary: NotifySummary): void {
  for (const result of summary.results) {
    const status = result.ok ? "ok" : "failed";
    const suffix = result.error ? `: ${result.error}` : "";
    console.log(`${result.surface}: ${status}${suffix}`);
  }
}

export async function runNotifyCommand(
  options: NotifyCommandOptions,
  deps: NotifyCommandDeps = {}
): Promise<NotifySummary> {
  if (!options.channel) throw new Error("Missing required option --channel");
  if (!options.message) throw new Error("Missing required option --message");

  const rawConfig = (deps.loadConfig ?? loadConfig)();
  const config = await (deps.resolveConfig ?? resolveStartupConfig)(rawConfig);
  const summary = await (deps.notifyImpl ?? notify)({
    config: config.notifications,
    channel: options.channel,
    message: options.message,
    surface: options.surface,
    mention: options.mention,
    discordToken: config.extensions?.discord?.token,
    slackToken: config.extensions?.slack?.token,
  });

  printNotifyResults(summary);
  return summary;
}

export function registerNotifyCommand(
  program: Command,
  deps: NotifyCommandDeps = {}
): Command {
  program
    .command("notify")
    .description("Send a Discord or Slack notification")
    .requiredOption("--channel <channel>", "Notification channel key")
    .requiredOption("--message <text>", "Message text")
    .option("--surface <surface>", "discord, slack, or both", "both")
    .option("--mention <userId>", "Mention user id")
    .action(async (options: NotifyCommandOptions) => {
      try {
        const summary = await runNotifyCommand(options, deps);
        if (!summary.ok) process.exit(1);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return program;
}
