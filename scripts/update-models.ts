import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const fetchAll = args.includes("--all");

async function main() {
  // Read aihub.json to get configured model IDs
  const configPath = resolve(
    process.env.AIHUB_CONFIG ||
      process.env.AIHUB_HOME
      ? `${process.env.AIHUB_HOME}/aihub.json`
      : resolve(process.env.HOME || "~", ".aihub", "aihub.json")
  );

  let configuredModels = new Set<string>();

  if (!fetchAll) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      const agents = config.agents ?? [];
      for (const agent of agents) {
        if (agent.model?.model) configuredModels.add(agent.model.model);
        // subagents
        const subagents = agent.subagents ?? [];
        for (const sub of subagents) {
          if (sub.model) configuredModels.add(sub.model);
        }
      }
    } catch {
      console.error("Could not read aihub.json. Use --all to fetch all models.");
      process.exit(1);
    }
  }

  console.log(
    fetchAll
      ? "Fetching all OpenRouter models..."
      : `Fetching ${configuredModels.size} configured models: ${[...configuredModels].join(", ")}`
  );

  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    console.error(`Failed to fetch OpenRouter models: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = await res.json();
  const models: Array<{ id: string; context_length: number }> = data.data;

  const result: Record<string, number> = {};

  for (const model of models) {
    if (!fetchAll && !configuredModels.has(model.id)) continue;
    if (typeof model.context_length === "number" && model.context_length > 0) {
      result[model.id] = model.context_length;
    }
  }

  const outPath = resolve(
    import.meta.dirname ?? "",
    "..",
    "packages",
    "shared",
    "src",
    "model-context-data.json"
  );
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(result).length} models to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
