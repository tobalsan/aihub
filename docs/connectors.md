# Connectors

Connectors are self-contained packages of agent tools that call external APIs. Unlike components (Discord, Slack — always-on infrastructure), connectors are **stateless tool providers** that only execute when an agent invokes a tool.

## Quick start

### 1. Create a connector directory

```bash
mkdir -p ~/.aihub/connectors/my-api
cd ~/.aihub/connectors/my-api
npm init -y
npm install zod
```

### 2. Write the connector

Create `index.js` (or compile from TypeScript):

```js
import { z } from "zod";

export default {
  id: "my_api",
  displayName: "My API",
  description: "Fetches data from My API",

  configSchema: z.object({
    apiKey: z.string(),
    baseUrl: z.string().optional().default("https://api.example.com"),
  }),

  requiredSecrets: ["apiKey"],

  createTools(config) {
    const { apiKey, baseUrl } = config.merged;

    return [
      {
        name: "list_items",
        description: "List all items from My API",
        parameters: z.object({
          page: z.number().optional().default(1),
          limit: z.number().optional().default(20),
        }),
        async execute(params) {
          const res = await fetch(`${baseUrl}/items?page=${params.page}&limit=${params.limit}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          return res.json();
        },
      },
      {
        name: "get_item",
        description: "Get a single item by ID",
        parameters: z.object({
          id: z.string(),
        }),
        async execute(params) {
          const res = await fetch(`${baseUrl}/items/${params.id}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          return res.json();
        },
      },
    ];
  },
};
```

### 3. Configure in `aihub.json`

```jsonc
{
  "version": 2,
  "connectors": {
    "path": "~/.aihub/connectors",    // where to find external connectors
    "my_api": {
      "apiKey": "$secret:my_api_key"   // or "$env:MY_API_KEY" or a raw string
    }
  },
  "agents": [
    {
      "id": "main",
      "name": "Main",
      // ...
      "connectors": {
        "my_api": { "enabled": true }
      }
    }
  ]
}
```

### 4. Restart AIHub

The connector is discovered at startup and its tools are injected into the agent's tool set. The agent can now call `my_api.list_items` and `my_api.get_item`.

---

## How it works

### Discovery

At startup, AIHub loads connectors from two sources:

1. **Built-in connectors** — shipped with AIHub (hardcoded imports)
2. **External connectors** — loaded from the connectors directory

The connectors directory defaults to `~/.aihub/connectors/`. Override it with `connectors.path` in config.

Each subdirectory in the connectors path is treated as a connector. AIHub does `import(path/to/connector/index.js)` and validates the default export against the connector contract.

If an external connector has the same `id` as a built-in, the external one **overrides** it.

### Config resolution

Connector config is resolved in two layers:

1. **Global** — `connectors.<connector_id>` at the config root (shared credentials/defaults)
2. **Per-agent** — `agent.connectors.<connector_id>` (overrides + enabled flag)

The merged config is `{ ...global, ...agentOverrides }`. Secret references (`$secret:name`, `$env:NAME`) are resolved before passing to the connector.

A connector is only loaded for agents that explicitly set `"enabled": true` in their `connectors` config.

### Tool namespacing

All connector tools are automatically namespaced as `{connector_id}.{tool_name}`. If your tool is named `list_items` and your connector ID is `my_api`, the agent sees `my_api.list_items`.

If a tool name already includes the connector ID prefix, it's kept as-is.

### Validation

At startup, AIHub validates:
- **Config schema** — `connector.configSchema.parse(mergedConfig)` for each enabled connector
- **Agent config schema** — `connector.agentConfigSchema.parse(agentConfig)` if defined
- **Required secrets** — checks that all `requiredSecrets` entries are non-empty strings in the merged config

Missing connectors referenced by agents produce a **warning** (non-fatal). Invalid config or missing secrets produce an **error** (fatal — startup fails).

---

## Connector contract

```typescript
interface ConnectorDefinition {
  id: string;                    // Unique identifier (e.g. "my_api")
  displayName: string;           // Human-readable name
  description: string;           // What this connector does

  configSchema: z.ZodTypeAny;    // Zod schema for merged config validation
  agentConfigSchema?: z.ZodTypeAny;  // Optional schema for per-agent overrides

  requiredSecrets: string[];     // Config keys that must be non-empty strings

  createTools(config: ResolvedConnectorConfig): ConnectorTool[];
}

interface ConnectorTool {
  name: string;                  // Tool name (auto-namespaced with connector ID)
  description: string;           // Shown to the LLM
  parameters: z.AnyZodObject;   // Must be a Zod object schema
  execute(params: unknown): Promise<unknown>;
}

interface ResolvedConnectorConfig {
  global: Record<string, unknown>;   // Global config (resolved secrets)
  agent: Record<string, unknown>;    // Per-agent overrides
  merged: Record<string, unknown>;   // { ...global, ...agent }
}
```

### Important constraints

- **`parameters` must be a `z.object({})`** — not a union, intersection, or primitive schema. Both the Claude and Pi SDK adapters require object-shaped schemas for tool parameter conversion.
- **`createTools` is called once per agent** when tools are loaded. Return tool instances that close over the resolved config.
- **Tool `execute` must return JSON-serializable data.** The result is stringified and passed back to the LLM.

---

## TypeScript development

For type safety when developing connectors in TypeScript:

```typescript
import type { ConnectorDefinition, ConnectorTool, ResolvedConnectorConfig } from "@aihub/shared";
import { z } from "zod";

const connector: ConnectorDefinition = {
  id: "my_api",
  displayName: "My API",
  description: "Connector for My API",
  configSchema: z.object({ apiKey: z.string() }),
  requiredSecrets: ["apiKey"],
  createTools(config: ResolvedConnectorConfig): ConnectorTool[] {
    // ...
  },
};

export default connector;
```

Compile with `tsc` and point `connectors.path` to the output directory's parent.

For local development, symlink your connector repo into the connectors directory:

```bash
ln -s ~/code/my-connector ~/.aihub/connectors/my-connector
```

---

## Directory structure

```
~/.aihub/connectors/
  my-api/
    index.js            # Default export: ConnectorDefinition
    package.json        # Optional, for npm dependencies
  another-connector/
    index.js
    package.json
```

Each connector is a self-contained directory. Dependencies are managed independently per connector (`npm install` inside the connector directory).

---

## Config reference

### Global connectors config

```jsonc
{
  "connectors": {
    "path": "~/.aihub/connectors",   // External connectors directory (default: ~/.aihub/connectors/)

    // Per-connector global config (keyed by connector ID):
    "my_api": {
      "apiKey": "$secret:my_api_key",
      "baseUrl": "https://api.example.com"
    }
  }
}
```

### Per-agent connector config

```jsonc
{
  "agents": [
    {
      "id": "main",
      "connectors": {
        "my_api": {
          "enabled": true,           // Required to activate the connector for this agent
          "baseUrl": "https://staging.example.com"  // Overrides global config
        }
      }
    }
  ]
}
```

### Secret references

Connector config values support the same secret resolution as the rest of AIHub:

- `"$secret:name"` — resolved via OneCLI Agent Vault (if `secrets.provider` is `"onecli"`)
- `"$env:NAME"` — resolved from `process.env.NAME`
- Raw string — used as-is
