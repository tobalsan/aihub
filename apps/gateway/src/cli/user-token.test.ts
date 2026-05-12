import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type EnvSnapshot = {
  aihubHome?: string;
  home?: string;
  userProfile?: string;
};

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  }
});

async function createTempHome(): Promise<{
  dir: string;
  previousEnv: EnvSnapshot;
}> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "aihub-user-token-"));
  tempDirs.push(dir);

  const previousEnv: EnvSnapshot = {
    aihubHome: process.env.AIHUB_HOME,
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
  };

  process.env.AIHUB_HOME = dir;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;

  await fsp.writeFile(
    path.join(dir, "aihub.json"),
    JSON.stringify({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      extensions: {
        multiUser: {
          enabled: true,
          oauth: {
            google: {
              clientId: "client-id",
              clientSecret: "client-secret",
            },
          },
          allowedDomains: ["example.com"],
          sessionSecret: "x".repeat(32),
        },
      },
    })
  );

  return { dir, previousEnv };
}

function restoreEnv(previousEnv: EnvSnapshot) {
  if (previousEnv.aihubHome === undefined) delete process.env.AIHUB_HOME;
  else process.env.AIHUB_HOME = previousEnv.aihubHome;

  if (previousEnv.home === undefined) delete process.env.HOME;
  else process.env.HOME = previousEnv.home;

  if (previousEnv.userProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousEnv.userProfile;
}

describe("aihub user token (bootstrap path)", () => {
  it("creates a token directly against the auth DB and caches it", async () => {
    const { dir, previousEnv } = await createTempHome();

    try {
      const { clearConfigCacheForTests } = await import(
        "../config/index.js"
      );
      clearConfigCacheForTests();

      const { createMultiUserAuth, initializeMultiUserDatabase } =
        await import("@aihub/extension-multi-user");
      const { loadConfig } = await import("../config/index.js");

      // Seed an approved user directly in the DB so the bootstrap path can find them.
      const config = loadConfig();
      const mu = config.extensions?.multiUser;
      if (!mu?.enabled) throw new Error("multiUser config missing");

      const db = initializeMultiUserDatabase(dir);
      // Run migrations and shape the user table.
      await createMultiUserAuth(config, mu, db);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO user (id, name, email, emailVerified, image, role, approved, createdAt, updatedAt)
         VALUES (@id, @name, @email, 1, NULL, 'user', 1, @createdAt, @updatedAt)`
      ).run({
        id: "user-1",
        name: "Tester",
        email: "tester@example.com",
        createdAt: now,
        updatedAt: now,
      });
      db.close();

      // Now exercise the bootstrap-path create flow via the CLI helper.
      const { createTokenInProcess, loadCachedToken, saveCachedToken } =
        await import("./user-token.js");

      const result = await createTokenInProcess({
        identifier: "tester@example.com",
        name: "ci",
      });

      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(16);
      expect(result.userId).toBe("user-1");
      expect(result.tokenId).toBeTruthy();

      // Cache it manually (mirrors what the CLI does after createTokenInProcess).
      saveCachedToken({
        token: result.token,
        tokenId: result.tokenId,
        userId: result.userId,
        createdAt: new Date().toISOString(),
      });

      const cached = loadCachedToken();
      expect(cached).not.toBeNull();
      expect(cached?.token).toBe(result.token);
      expect(cached?.tokenId).toBe(result.tokenId);

      // File mode should be 0600.
      const cachePath = path.join(dir, "user-token.json");
      const stat = fs.statSync(cachePath);
      // On POSIX, mask the perm bits and assert owner-only rw.
      if (process.platform !== "win32") {
        expect(stat.mode & 0o777).toBe(0o600);
      }

      // And the apikey row exists for this user.
      const db2 = initializeMultiUserDatabase(dir);
      const cols = db2.pragma("table_info(apikey)") as Array<{
        name: string;
      }>;
      const ownerCol = cols.some((c) => c.name === "userId")
        ? "userId"
        : "referenceId";
      const row = db2
        .prepare(`SELECT ${ownerCol} as owner FROM apikey WHERE id = ?`)
        .get(result.tokenId) as { owner?: string } | undefined;
      db2.close();
      expect(row?.owner).toBe("user-1");
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("rejects unknown user identifiers", async () => {
    const { previousEnv } = await createTempHome();

    try {
      const { clearConfigCacheForTests } = await import(
        "../config/index.js"
      );
      clearConfigCacheForTests();

      const { createTokenInProcess } = await import("./user-token.js");
      await expect(
        createTokenInProcess({ identifier: "ghost@example.com" })
      ).rejects.toThrow(/No user matched/);
    } finally {
      restoreEnv(previousEnv);
    }
  });
});
