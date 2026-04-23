export type SlackWebClient = {
  auth?: {
    test(params?: Record<string, unknown>): Promise<{ user_id?: string }>;
  };
  users?: {
    info(params: { user: string }): Promise<{
      user?: {
        profile?: {
          display_name?: string;
          real_name?: string;
        };
        real_name?: string;
        name?: string;
      };
    }>;
  };
  chat: {
    postMessage(params: {
      channel: string;
      text: string;
      mrkdwn?: boolean;
      thread_ts?: string;
      unfurl_links?: boolean;
      unfurl_media?: boolean;
    }): Promise<{ ts?: string }>;
    update(params: {
      channel: string;
      ts: string;
      text: string;
      mrkdwn?: boolean;
    }): Promise<unknown>;
    delete(params: { channel: string; ts: string }): Promise<unknown>;
  };
  conversations: {
    info(params: {
      channel: string;
    }): Promise<{
      channel?: { name?: string; topic?: { value?: string } };
    }>;
    history(params: {
      channel: string;
      latest?: string;
      inclusive?: boolean;
      limit?: number;
    }): Promise<{
      messages?: Array<{
        user?: string;
        username?: string;
        text?: string;
        ts?: string;
      }>;
    }>;
  };
  reactions: {
    add(params: {
      channel: string;
      timestamp: string;
      name: string;
    }): Promise<unknown>;
    remove(params: {
      channel: string;
      timestamp: string;
      name: string;
    }): Promise<unknown>;
  };
};

export type SlackThreadPolicy = "always" | "never" | "follow";
