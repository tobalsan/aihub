import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "@aihub/shared";
import { initializeMultiUserDatabase } from "./db.js";
import { createMultiUserAuth } from "./auth.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("multi-user auth", () => {
  it("creates auth instance and runs Better Auth migrations", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-auth-"));
    tempDirs.push(tempDir);

    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      gateway: {
        port: 4123,
      },
      extensions: {
        multiUser: {
          enabled: true,
          oauth: {
            google: {
              clientId: "client-id",
              clientSecret: "client-secret",
            },
          },
          sessionSecret: "x".repeat(32),
        },
      },
    });

    const db = initializeMultiUserDatabase(path.join(tempDir, "auth.db"));
    const multiUserConfig = config.extensions?.multiUser;
    if (!multiUserConfig || !multiUserConfig.enabled) {
      throw new Error("multiUser config missing");
    }

    const auth = await createMultiUserAuth(config, multiUserConfig, db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    db.close();

    expect(typeof auth.handler).toBe("function");
    expect(typeof auth.api.getSession).toBe("function");
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "account",
        "agent_assignments",
        "session",
        "user",
        "verification",
      ])
    );
  });
});
