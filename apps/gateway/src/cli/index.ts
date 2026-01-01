#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, getAgents, getAgent, setSingleAgentMode } from "../config/index.js";
import { startServer } from "../server/index.js";
import { startDiscordBots, stopDiscordBots } from "../discord/index.js";
import { startScheduler, stopScheduler } from "../scheduler/index.js";
import { startAmsgWatcher, stopAmsgWatcher } from "../amsg/index.js";
import { runAgent } from "../agents/index.js";

const program = new Command();

program
  .name("aihub")
  .description("AIHub multi-agent gateway")
  .version("0.1.0");

program
  .command("gateway")
  .description("Start the gateway server (multi-agent mode)")
  .option("-p, --port <port>", "Server port", "4000")
  .option("-h, --host <host>", "Server host", "127.0.0.1")
  .option("--agent-id <id>", "Single-agent mode: only load this agent")
  .action(async (opts) => {
    try {
      const config = loadConfig();
      console.log(`Loaded config with ${config.agents.length} agent(s)`);

      if (opts.agentId) {
        const agent = getAgent(opts.agentId);
        if (!agent) {
          console.error(`Agent not found: ${opts.agentId}`);
          process.exit(1);
        }
        setSingleAgentMode(opts.agentId);
        console.log(`Single-agent mode: ${agent.name} (${agent.id})`);
      }

      // Start server
      const port = parseInt(opts.port, 10);
      startServer(port, opts.host);

      // Start Discord bots
      await startDiscordBots();

      // Start scheduler
      await startScheduler();

      // Start amsg watcher
      startAmsgWatcher();

      // Handle shutdown
      const shutdown = async () => {
        console.log("\nShutting down...");
        stopAmsgWatcher();
        await stopScheduler();
        await stopDiscordBots();
        process.exit(0);
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    } catch (err) {
      console.error("Failed to start gateway:", err);
      process.exit(1);
    }
  });

program
  .command("agent")
  .description("Manage agents")
  .command("list")
  .description("List all configured agents")
  .action(() => {
    try {
      const agents = getAgents();
      console.log("Configured agents:");
      for (const agent of agents) {
        console.log(`  - ${agent.id}: ${agent.name} (${agent.model.provider}/${agent.model.model})`);
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program
  .command("send")
  .description("Send a message to an agent")
  .requiredOption("-a, --agent <id>", "Agent ID")
  .requiredOption("-m, --message <text>", "Message to send")
  .option("-s, --session <id>", "Session ID", "default")
  .action(async (opts) => {
    try {
      const agent = getAgent(opts.agent);
      if (!agent) {
        console.error(`Agent not found: ${opts.agent}`);
        process.exit(1);
      }

      console.log(`Sending to ${agent.name}...`);
      const result = await runAgent({
        agentId: agent.id,
        message: opts.message,
        sessionId: opts.session,
        onEvent: (event) => {
          if (event.type === "text") {
            process.stdout.write(event.data);
          }
        },
      });

      console.log("\n");
      console.log(`Duration: ${result.meta.durationMs}ms`);
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program.parse();
