import { Logger } from '@ixo/logger';
import { App, LogLevel, SocketModeReceiver } from '@slack/bolt';
import {
  type ChatDeleteArguments,
  type ChatUpdateArguments,
} from '@slack/web-api';
import { type MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { type Profile } from '@slack/web-api/dist/types/response/ConversationsListConnectInvitesResponse';
import slackfiy from 'slackify-markdown';
import {
  type ChatPostMessageResponse,
  type ListMembersResponse,
  type PostMessageParams,
} from '../types';
import { splitLongSlackBlocks } from '../utils/split-long-slack-blocks-message';

/**
 * A class for interacting with the Slack API
 */
export class Slack {
  private app: App;

  /**
   * Creates a new Slack instance
   * @param BOT_OAUTH_TOKEN - The bot OAuth token for authentication
   * @param SLACK_APP_LEVEL_TOKEN - The app-level token for socket mode
   */
  constructor(BOT_OAUTH_TOKEN: string, SLACK_APP_LEVEL_TOKEN: string) {
    const socketModeReceiver = new SocketModeReceiver({
      appToken: SLACK_APP_LEVEL_TOKEN,
      logLevel: LogLevel.INFO,
    });

    this.app = new App({
      receiver: socketModeReceiver,
      token: BOT_OAUTH_TOKEN,
      appToken: SLACK_APP_LEVEL_TOKEN,
      socketMode: true,
    });
  }

  /**
   * Posts a message to a Slack channel
   * @param params - The parameters for posting a message
   * @returns A promise that resolves to the chat post message response
   * @throws Error if channel is missing or if both text and blocks are missing
   */
  public async postMessage(
    params: PostMessageParams,
  ): Promise<ChatPostMessageResponse> {
    const { channel, text, blocks, threadTs, format } = params;
    if (!channel) {
      throw new Error('channel is required');
    }

    if (!text && !blocks) {
      throw new Error('text or blocks is required');
    }

    const res = await this.app.client.chat.postMessage({
      channel,
      text: format && text ? slackfiy(text) : text,
      blocks: blocks ? splitLongSlackBlocks(blocks) : [],
      thread_ts: threadTs,
    });

    if (!res.ok) {
      Logger.error(res.error || 'Failed to post message');
      throw new Error('Failed to post message');
    }

    return res;
  }

  /**
   * Gets the chat history in a thread
   * @param channel - The channel ID
   * @param threadId - The thread ID
   * @returns A promise that resolves to an array of message elements
   * @throws Error if the API call fails
   */
  public async getChatHistoryInThread(
    channel: string,
    threadId: string,
  ): Promise<MessageElement[]> {
    const res = await this.app.client.conversations.replies({
      channel,
      ts: threadId,
    });

    if (!res.ok) {
      Logger.error(res.error || 'Failed to get chat history in thread');
      throw new Error('Failed to get chat history in thread');
    }

    return res.messages || [];
  }

  /**
   * Posts an ephemeral message visible only to a specific user
   * @param params - The parameters for posting an ephemeral message
   * @returns A promise that resolves to the chat post message response
   * @throws Error if the API call fails
   */
  public async postEphemeral(
    params: Pick<PostMessageParams, 'channel' | 'text' | 'blocks'> & {
      user: string;
    },
  ): Promise<ChatPostMessageResponse> {
    const { channel, user, text, blocks } = params;
    const res = await this.app.client.chat.postEphemeral({
      channel,
      user,
      text: text ? slackfiy(text) : undefined,
      blocks: blocks ? splitLongSlackBlocks(blocks) : [],
    });

    if (!res.ok) {
      Logger.error(res.error || 'Failed to post ephemeral message');
      throw new Error('Failed to post ephemeral message');
    }

    return res;
  }

  /**
   * Updates an existing message
   * @param params - The parameters for updating a message
   * @throws Error if the API call fails
   */
  public async updateMessage(params: ChatUpdateArguments): Promise<void> {
    const res = await this.app.client.chat.update(params);

    if (!res.ok) {
      Logger.error(res.error || 'Failed to update message');
      throw new Error('Failed to update message');
    }
  }

  /**
   * Deletes a message
   * @param params - The parameters for deleting a message
   * @throws Error if the API call fails
   */
  public async deleteMessage(params: ChatDeleteArguments): Promise<void> {
    const res = await this.app.client.chat.delete(params);

    if (!res.ok) {
      Logger.error(res.error || 'Failed to delete message');
      throw new Error('Failed to delete message');
    }
  }

  /**
   * Lists members in the workspace
   * @param cursor - The cursor for pagination
   * @param limit - The maximum number of members to return (default: 100)
   * @returns A promise that resolves to the list members response
   * @throws Error if the API call fails
   */
  public async listMembers(
    cursor?: string,
    limit = 100,
  ): Promise<ListMembersResponse> {
    const res = await this.app.client.users.list({
      limit,
      cursor,
    });

    if (!res.ok) {
      Logger.error(res.error || 'Failed to list members');
      throw new Error('Failed to list members');
    }

    return {
      members: res.members,
      nextCursor: res.response_metadata?.next_cursor,
    };
  }

  /**
   * Gets a user's profile
   * @param userId - The ID of the user
   * @returns A promise that resolves to the user's profile with their user ID
   * @throws Error if the API call fails
   */
  public async getUserProfile(userId: string): Promise<
    | (Profile & {
        userId: string;
      })
    | undefined
  > {
    const res = await this.app.client.users.profile.get({
      user: userId,
    });

    if (!res.ok) {
      Logger.error(res.error || 'Failed to get user profile');
      throw new Error('Failed to get user profile');
    }

    return {
      ...res.profile,
      userId,
    };
  }

  /**
   * Gets the current user's profile (oracle bot profile)
   * @returns A promise that resolves to the current user's profile
   * @throws Error if the API call fails
   */
  public async getCurrentUserProfile(): Promise<
    | (Profile & {
        userId: string;
      })
    | undefined
  > {
    const res = await this.app.client.auth.test();

    if (!res.ok || !res.user_id) {
      Logger.error(res.error || 'Failed to get current user');
      throw new Error('Failed to get current user');
    }

    const profile = await this.getUserProfile(res.user_id);

    return profile;
  }

  /**
   * Starts the Slack app
   */
  public async start(): Promise<void> {
    await this.app.start();
  }

  /**
   * Stops the Slack app
   */
  public async stop(): Promise<void> {
    await this.app.stop();
  }
}
