import type { NotificationsConfig } from "./types.js";

export type NotifySurface = "discord" | "slack" | "both";

export type NotifyOptions = {
  config?: NotificationsConfig;
  channel: string;
  message: string;
  surface?: string;
  mention?: string;
  discordToken?: string;
  slackToken?: string;
  fetchImpl?: typeof fetch;
  adapters?: Partial<NotifyAdapters>;
};

export type NotifyResult = {
  surface: Exclude<NotifySurface, "both">;
  ok: boolean;
  channelId: string;
  error?: string;
};

export type NotifySummary = {
  ok: boolean;
  results: NotifyResult[];
};

export type NotifyAdapters = {
  discord: (params: NotifyAdapterParams) => Promise<void>;
  slack: (params: NotifyAdapterParams) => Promise<void>;
};

export type NotifyAdapterParams = {
  channelId: string;
  text: string;
  token: string;
  fetchImpl: typeof fetch;
};

type ConcreteSurface = Exclude<NotifySurface, "both">;

const VALID_SURFACES = new Set(["discord", "slack", "both"]);

export function isNotifySurface(value: string): value is NotifySurface {
  return VALID_SURFACES.has(value);
}

function withMention(surface: ConcreteSurface, message: string, mention?: string): string {
  if (!mention) return message;
  return `<@${mention}> ${message}`;
}

async function postDiscord({
  channelId,
  text,
  token,
  fetchImpl,
}: NotifyAdapterParams): Promise<void> {
  const response = await fetchImpl(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: text }),
    }
  );
  if (!response.ok) {
    throw new Error(`Discord API returned ${response.status}`);
  }
}

function getSlackError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

async function postSlack({
  channelId,
  text,
  token,
  fetchImpl,
}: NotifyAdapterParams): Promise<void> {
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Slack response was not valid JSON");
  }

  if ((payload as { ok?: unknown }).ok !== true) {
    throw new Error(getSlackError(payload) ?? "Slack response missing ok: true");
  }
}

function resolveSurfaces(surface: string | undefined): NotifySurface {
  const requested = surface ?? "both";
  if (!isNotifySurface(requested)) {
    throw new Error(`Invalid notify surface "${requested}"`);
  }
  return requested;
}

export async function notify(options: NotifyOptions): Promise<NotifySummary> {
  const requestedSurface = resolveSurfaces(options.surface);
  const channel = options.config?.channels?.[options.channel];
  if (!channel) {
    throw new Error(`Notification channel not configured: ${options.channel}`);
  }

  const surfaces: ConcreteSurface[] =
    requestedSurface === "both" ? ["discord", "slack"] : [requestedSurface];
  const targets = surfaces.filter((surface) => Boolean(channel[surface]));
  if (targets.length === 0) {
    throw new Error(
      `No ${requestedSurface} notification target configured for channel "${options.channel}"`
    );
  }

  const adapters: NotifyAdapters = {
    discord: options.adapters?.discord ?? postDiscord,
    slack: options.adapters?.slack ?? postSlack,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const results: NotifyResult[] = [];

  for (const surface of targets) {
    const token = surface === "discord" ? options.discordToken : options.slackToken;
    const channelId = channel[surface];
    if (!channelId) continue;
    if (!token) {
      results.push({
        surface,
        channelId,
        ok: false,
        error: `Missing ${surface} token`,
      });
      continue;
    }

    try {
      await adapters[surface]({
        channelId,
        token,
        fetchImpl,
        text: withMention(surface, options.message, options.mention),
      });
      results.push({ surface, channelId, ok: true });
    } catch (err) {
      results.push({
        surface,
        channelId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: results.some((result) => result.ok),
    results,
  };
}
