/**
 * Channel metadata utility
 * Fetches channel name and topic (when available)
 */

import type { Client } from "@buape/carbon";

export type ChannelMetadata = {
  name?: string;
  topic?: string;
};

/**
 * Get channel metadata (name and topic)
 * Topic is only available for text channels, not threads or DMs
 */
export async function getChannelMetadata(
  client: Client,
  channelId: string
): Promise<ChannelMetadata> {
  try {
    const channel = (await client.rest.get(`/channels/${channelId}`)) as {
      name?: string;
      topic?: string | null;
      type?: number;
    };

    return {
      name: channel.name,
      topic: channel.topic ?? undefined,
    };
  } catch {
    // Fetch failed - return empty metadata
    return {};
  }
}
