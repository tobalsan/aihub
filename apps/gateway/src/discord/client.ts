/**
 * Carbon-based Discord client wrapper
 * Provides Gateway event handling via Carbon's GatewayPlugin
 */

import {
  Client,
  type ClientOptions,
  type Command,
  MessageCreateListener,
  MessageReactionAddListener,
  MessageReactionRemoveListener,
  ReadyListener,
  type ListenerEventData,
  GatewayDispatchEvents,
} from "@buape/carbon";
import { GatewayPlugin, GatewayIntents } from "@buape/carbon/gateway";

export type { Client as CarbonClient };

// Event handler types
export type MessageHandler = (data: ListenerEventData[typeof GatewayDispatchEvents.MessageCreate], client: Client) => Promise<void>;
export type ReactionHandler = (
  data: ListenerEventData[typeof GatewayDispatchEvents.MessageReactionAdd] | ListenerEventData[typeof GatewayDispatchEvents.MessageReactionRemove],
  client: Client,
  added: boolean
) => Promise<void>;
export type ReadyHandler = (data: ListenerEventData[typeof GatewayDispatchEvents.Ready], client: Client) => void;

export interface DiscordClientConfig {
  token: string;
  clientId: string;
  publicKey?: string;
  commands?: Command[];
  onMessage?: MessageHandler;
  onReaction?: ReactionHandler;
  onReady?: ReadyHandler;
}

// Create dynamic listener classes with callbacks
function createMessageListener(handler: MessageHandler): MessageCreateListener {
  return new (class extends MessageCreateListener {
    async handle(data: ListenerEventData[typeof GatewayDispatchEvents.MessageCreate], client: Client) {
      await handler(data, client);
    }
  })();
}

function createReactionAddListener(handler: ReactionHandler): MessageReactionAddListener {
  return new (class extends MessageReactionAddListener {
    async handle(data: ListenerEventData[typeof GatewayDispatchEvents.MessageReactionAdd], client: Client) {
      await handler(data, client, true);
    }
  })();
}

function createReactionRemoveListener(handler: ReactionHandler): MessageReactionRemoveListener {
  return new (class extends MessageReactionRemoveListener {
    async handle(data: ListenerEventData[typeof GatewayDispatchEvents.MessageReactionRemove], client: Client) {
      await handler(data, client, false);
    }
  })();
}

function createReadyListener(handler: ReadyHandler): ReadyListener {
  return new (class extends ReadyListener {
    async handle(data: ListenerEventData[typeof GatewayDispatchEvents.Ready], client: Client) {
      handler(data, client);
    }
  })();
}

/**
 * Create a Carbon Discord client with Gateway plugin
 */
export function createCarbonClient(config: DiscordClientConfig): Client {
  const listeners = [];

  // Add message listener if handler provided
  if (config.onMessage) {
    listeners.push(createMessageListener(config.onMessage));
  }

  // Add reaction listeners if handler provided
  if (config.onReaction) {
    listeners.push(createReactionAddListener(config.onReaction));
    listeners.push(createReactionRemoveListener(config.onReaction));
  }

  // Add ready listener if handler provided
  if (config.onReady) {
    listeners.push(createReadyListener(config.onReady));
  }

  const clientOptions: ClientOptions = {
    baseUrl: "", // Not used for Gateway-only bot
    clientId: config.clientId,
    publicKey: config.publicKey || "dummy", // Required but not used for Gateway
    token: config.token,
    disableDeployRoute: true,
    disableInteractionsRoute: true,
    disableEventsRoute: true,
  };

  const gatewayPlugin = new GatewayPlugin({
    intents:
      GatewayIntents.Guilds |
      GatewayIntents.GuildMessages |
      GatewayIntents.MessageContent |
      GatewayIntents.DirectMessages |
      GatewayIntents.GuildMessageReactions,
    autoInteractions: Boolean(config.commands?.length),
  });

  const client = new Client(
    clientOptions,
    { commands: config.commands, listeners },
    [gatewayPlugin]
  );

  return client;
}

/**
 * Get the GatewayPlugin from a client (for lifecycle management)
 */
export function getGatewayPlugin(client: Client): GatewayPlugin | undefined {
  return client.getPlugin<GatewayPlugin>("gateway");
}
