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
  const candidates = [
    config.server?.baseUrl,
    config.web?.baseUrl,
    getAuthBaseUrl(config),
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

            return {
              data: {
                ...user,
                approved: false,
              },
            };
          },
          after: async (user) => {
            const userCount = db
              .prepare("SELECT COUNT(*) AS count FROM user")
              .get() as { count: number };

            if (userCount.count !== 1) return;

            db.prepare(
              "UPDATE user SET role = ?, approved = ? WHERE id = ?"
            ).run("admin", 1, user.id);
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
