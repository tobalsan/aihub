import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins/admin";
import type Database from "better-sqlite3";
import type { GatewayConfig, MultiUserConfig } from "@aihub/shared";

function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

function getAuthBaseUrl(config: GatewayConfig): string {
  const configured =
    config.server?.baseUrl ??
    config.web?.baseUrl ??
    `http://127.0.0.1:${config.gateway?.port ?? 4000}`;
  return normalizeOrigin(configured);
}

function getTrustedOrigins(config: GatewayConfig): string[] {
  const uiPort = config.ui?.port ?? 3000;
  const candidates = [
    config.server?.baseUrl,
    config.web?.baseUrl,
    getAuthBaseUrl(config),
    // Dev mode: web UI runs on a separate port
    `http://localhost:${uiPort}`,
    `http://127.0.0.1:${uiPort}`,
  ].filter((value): value is string => !!value);

  return [...new Set(candidates.map(normalizeOrigin))];
}

function isAllowedDomain(email: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain);
}

export type MultiUserAuth = {
  handler: ReturnType<typeof betterAuth>["handler"];
  api: ReturnType<typeof betterAuth>["api"] & {
    listUsers(args: {
      headers: Headers;
      query: Record<string, never>;
    }): Promise<{ users: Array<Record<string, unknown>>; total: number }>;
    getUser(args: {
      headers: Headers;
      query: { id: string };
    }): Promise<Record<string, unknown> | null>;
    setRole(args: {
      headers: Headers;
      body: { userId: string; role: string };
    }): Promise<{ user: Record<string, unknown> }>;
  };
};

function buildMultiUserAuth(
  config: GatewayConfig,
  multiUserConfig: Extract<MultiUserConfig, { enabled: true }>,
  db: Database.Database
) {
  return betterAuth({
    appName: "AIHub",
    baseURL: getAuthBaseUrl(config),
    basePath: "/api/auth",
    secret: multiUserConfig.sessionSecret,
    database: db,
    trustedOrigins: getTrustedOrigins(config),
    socialProviders: {
      google: {
        clientId: multiUserConfig.oauth.google.clientId,
        clientSecret: multiUserConfig.oauth.google.clientSecret,
        prompt: "select_account",
      },
    },
    user: {
      additionalFields: {
        approved: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300,
      },
    },
    plugins: [
      admin({
        defaultRole: "user",
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isAllowedDomain(user.email, multiUserConfig.allowedDomains)) {
              throw new APIError("FORBIDDEN", {
                message: "Email domain is not allowed",
              });
            }

            // First user becomes admin and is auto-approved.
            // Must be set in `before` so the session is created with correct values;
            // `after` hook updates bypass the session cache.
            const userCount = db
              .prepare("SELECT COUNT(*) AS count FROM user")
              .get() as { count: number };
            const isFirstUser = userCount.count === 0;

            return {
              data: {
                ...user,
                approved: isFirstUser,
                ...(isFirstUser && { role: "admin" }),
              },
            };
          },
        },
      },
    },
  });
}

export async function createMultiUserAuth(
  config: GatewayConfig,
  multiUserConfig: Extract<MultiUserConfig, { enabled: true }>,
  db: Database.Database
): Promise<MultiUserAuth> {
  const auth = buildMultiUserAuth(config, multiUserConfig, db);

  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  return auth as unknown as MultiUserAuth;
}
