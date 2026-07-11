import { IrcExtensionConfigSchema, type Extension } from "@aihub/shared";
import { IrcRouter } from "./router.js";
import { IrcService } from "./service.js";
let service: IrcService | null = null;
const ircExtension: Extension = { id: "irc", displayName: "IRC", description: "IRC channel and direct-message routing", dependencies: [], configSchema: IrcExtensionConfigSchema, routePrefixes: [], validateConfig(raw) { const result = IrcExtensionConfigSchema.safeParse(raw); return { valid: result.success, errors: result.success ? [] : result.error.issues.map((issue) => issue.message) }; }, registerRoutes() {}, async start(ctx) { const parsed = IrcExtensionConfigSchema.safeParse(ctx.getConfig().extensions?.irc); if (!parsed.success || parsed.data.enabled === false) return; let router: IrcRouter; service = new IrcService({ ...parsed.data, channels: Object.keys(parsed.data.channels) }, (message) => router.handle(message)); router = new IrcRouter(ctx, parsed.data, service); service.start(); }, async stop() { service?.stop(); service = null; }, capabilities() { return ["irc"]; } };
export { ircExtension };
export * from "./protocol.js";
export * from "./loop-guard.js";
