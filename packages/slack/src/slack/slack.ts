import { Logger } from '@ixo/logger';
import { App, SocketModeReceiver } from '@slack/bolt';
import {
  LogLevel,
  type ChatDeleteArguments,
  type ChatUpdateArguments,
} from '@slack/web-api';
import { type MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { type Profile } from '@slack/web-api/dist/types/response/ConversationsListConnectInvitesResponse';
import { markdownToBlocks } from '@tryfabric/mack';
import {
  type ChatPostMessageResponse,
  type ListMembersResponse,
  type PostMessageParams,
} from '../types';
import { transformMarkdown } from '../utils/transform-markdown';

export interface SlackOptions {
  /**
   * Whether to use Socket Mode for real-time events
   * Set to false for services that only need to send messages
   * @default true
   */
  useSocketMode?: boolean;

  /**
   * Log level for the Slack SDK
   * @default LogLevel.ERROR
   */
  logLevel?: LogLevel;
}

/**
 * A class for interacting with the Slack API
 */
export class Slack {
  public readonly app: App;
  private isStarted = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly maxReconnectDelay = 60000; // Max 60 seconds
  private readonly socketModeReceiver?: SocketModeReceiver;
  private readonly useSocketMode: boolean;

  /**
   * Creates a new Slack instance
   * @param BOT_OAUTH_TOKEN - The bot OAuth token for authentication
   * @param SLACK_APP_TOKEN - The app-level token for socket mode (only required if useSocketMode is true)
   * @param options - Configuration options
   */
  constructor(
    BOT_OAUTH_TOKEN: string,
    SLACK_APP_TOKEN?: string,
    options: SlackOptions = {},
  ) {
    const { useSocketMode = true, logLevel = LogLevel.ERROR } = options;
    this.useSocketMode = useSocketMode;

    if (useSocketMode) {
      if (!SLACK_APP_TOKEN) {
        throw new Error(
          'SLACK_APP_TOKEN is required when useSocketMode is true',
        );
      }

      this.socketModeReceiver = new SocketModeReceiver({
        appToken: SLACK_APP_TOKEN,
        clientId: BOT_OAUTH_TOKEN,
      });

      this.app = new App({
        receiver: this.socketModeReceiver,
        token: BOT_OAUTH_TOKEN,
        appToken: SLACK_APP_TOKEN,
        socketMode: true,
        logLevel,
      });

      this.setupErrorHandlers();
    } else {
      // HTTP mode - no Socket Mode, no real-time events
      this.app = new App({
        token: BOT_OAUTH_TOKEN,
        socketMode: false,
        logLevel,
      });

      Logger.info('Slack initialized in HTTP mode (no real-time events)');
    }
  }

  /**
   * Sets up error handlers for Socket Mode connection issues
   * Only called when Socket Mode is enabled
   */
  private setupErrorHandlers(): void {
    if (!this.useSocketMode) return;

    // Handle general application errors with comprehensive error handling
    this.app.error(async (error) => {
      Logger.error('Slack App error:', {
        error: error.message || String(error),
        stack: error.stack,
        code: error.code,
      });

      // Check if this is a Socket Mode connection error that needs fallback handling
      if (this.isSocketModeError(error) && !this.isGracefulDisconnect(error)) {
        Logger.warn(
          'Socket Mode connection error detected - activating fallback handling',
        );
        this.handleConnectionError(error);
      }
    });

    // Set up connection monitoring using Bolt SDK events
    this.setupConnectionMonitoring();
  }

  /**
   * Sets up connection lifecycle monitoring using Slack Bolt SDK events
   */
  private setupConnectionMonitoring(): void {
    try {
      // Access the receiver to listen for Socket Mode events
      const receiver = this.socketModeReceiver?.client;

      // Listen for Socket Mode connection events
      receiver?.on('connected', () => {
        Logger.info('Socket Mode connected successfully');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      });

      receiver?.on('disconnected', (error) => {
        if (error) {
          Logger.warn('Socket Mode disconnected with error:', error.message);
          this.handleConnectionError(error);
        } else {
          Logger.info(
            'Socket Mode disconnected gracefully (periodic disconnection - normal behavior every couple of hours)',
          );
          this.reconnectAttempts = 0; // Reset for graceful disconnects
        }
      });

      receiver?.on('reconnecting', () => {
        this.reconnectAttempts++;
        Logger.info(
          `Socket Mode reconnecting... (attempt ${this.reconnectAttempts})`,
        );
      });

      receiver?.on('reconnected', () => {
        Logger.info('Socket Mode reconnected successfully');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      });

      receiver?.on('error', (error: any) => {
        Logger.error('Socket Mode receiver error:', error.message);
        this.handleConnectionError(error);
      });

      // Listen for when Socket Mode fails to start
      receiver?.on('unable_to_socket_mode_start', (error: any) => {
        Logger.error('Unable to start Socket Mode:', error.message);
        this.handleConnectionError(error);
      });

      // Listen for WebSocket close events if available
      receiver?.on('close', (code?: number, reason?: string) => {
        Logger.info(
          `Socket Mode WebSocket closed - Code: ${code}, Reason: ${reason || 'none'}`,
        );
        if (code && !this.isNormalCloseCode(code)) {
          this.handleConnectionError(
            new Error(`WebSocket closed with abnormal code: ${code}`),
          );
        }
      });
    } catch (error) {
      Logger.warn(
        'Could not set up Socket Mode event monitoring - using fallback error handling only',
      );
    }
  }

  /**
   * Checks if a WebSocket close code is normal (1000-1001 are normal)
   */
  private isNormalCloseCode(code: number): boolean {
    return code === 1000 || code === 1001;
  }

  /**
   * Checks if a disconnect is a graceful periodic disconnection vs an error
   */
  private isGracefulDisconnect(error: any): boolean {
    const errorMessage = error.message || String(error);
    const gracefulPatterns = [
      'connection closed normally',
      'normal closure',
      'going away',
      'periodic disconnection',
      '1000', // Normal closure code
      '1001', // Going away code
    ];

    return gracefulPatterns.some((pattern) =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  /**
   * Checks if an error is related to Socket Mode connectivity
   */
  private isSocketModeError(error: any): boolean {
    const errorMessage = error.message || String(error);
    const socketModeErrorPatterns = [
      'socket disconnected',
      'websocket',
      'connection closed',
      'connection lost',
      'connection refused',
      'connection timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'socket hang up',
      'unexpected server response',
      'invalid frame header',
      'connection failed',
    ];

    return socketModeErrorPatterns.some((pattern) =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  /**
   * Handles connection errors with fallback mechanisms
   */
  private handleConnectionError(error: any): void {
    if (!this.isStarted) {
      return; // Don't handle errors if we're intentionally stopped
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      Logger.error(
        `High number of reconnection attempts (${this.reconnectAttempts}). Relying on Bolt SDK automatic reconnection. Error: ${error.message}`,
      );
      return;
    }

    Logger.info(
      `Socket Mode error detected. Bolt SDK should handle reconnection automatically. (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    // Implement exponential backoff fallback if Bolt SDK reconnection fails
    setTimeout(() => {
      const handler = async () => {
        try {
          // Check if we're still disconnected after giving Bolt SDK time
          const isHealthy = await this.checkConnectionHealth();

          if (!isHealthy) {
            Logger.warn(
              'Connection still unhealthy after Bolt SDK reconnection attempt - trying manual restart as fallback',
            );
            await this.restartConnection();
            Logger.info('Fallback manual Socket Mode reconnection successful');
          } else {
            Logger.info(
              'Bolt SDK automatic reconnection appears to have worked',
            );
            this.reconnectAttempts = 0; // Reset since we're connected
          }
        } catch (fallbackError) {
          Logger.error('Fallback reconnection failed:', fallbackError);
          // Exponential backoff for next attempt
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.maxReconnectDelay,
          );
        }
      };
      handler().catch((error) => {
        Logger.error('Fallback reconnection failed:', error);
      });
    }, this.reconnectDelay);
  }

  /**
   * Checks connection health without throwing errors
   */
  private async checkConnectionHealth(): Promise<boolean> {
    try {
      await this.app.client.auth.test();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Restarts the connection as a fallback mechanism
   */
  private async restartConnection(): Promise<void> {
    if (this.isStarted) {
      await this.stop();
      // Small delay before restart
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await this.start();
  }

  /**
   * Starts health monitoring for the Socket Mode connection
   */
  private startHealthMonitoring(): void {
    if (!this.useSocketMode) return;

    // Health check every 60 seconds (less frequent since SDK handles reconnections)
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.app.client.auth.test();

        // Connection is healthy - reset any error counters
        if (this.reconnectAttempts > 0) {
          Logger.debug('Connection healthy - resetting reconnection counter');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
        }
      } catch (error) {
        Logger.warn(
          'Health check failed - connection may be unhealthy:',
          error,
        );

        // If health check fails consistently, trigger error handling
        if (this.reconnectAttempts === 0) {
          this.handleConnectionError(error);
        }
      }
    }, 60000); // Check every minute
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
      blocks: format && text ? await markdownToBlocks(text) : [],
      text: format && text ? text : undefined,
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
    params: Pick<PostMessageParams, 'channel' | 'text'> & {
      user: string;
    },
  ): Promise<ChatPostMessageResponse> {
    const { channel, user, text } = params;
    const res = await this.app.client.chat.postEphemeral({
      channel,
      user,
      blocks: text ? await markdownToBlocks(text) : [],
      text: text ? transformMarkdown(text) : undefined,
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
   * Starts the Slack app with enhanced error handling
   */
  public async start(): Promise<void> {
    try {
      if (this.isStarted) {
        Logger.warn('Slack app is already started');
        return;
      }

      if (this.useSocketMode) {
        Logger.info('Starting Slack Socket Mode connection...');
        await this.app.start();
        this.startHealthMonitoring();
        Logger.info('Slack Socket Mode connection established successfully');
      } else {
        Logger.info('Starting Slack in HTTP mode...');
        // HTTP mode doesn't need to "start" like Socket Mode
        // The app is ready to use immediately
        Logger.info('Slack HTTP mode ready');
      }

      this.isStarted = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
    } catch (error) {
      Logger.error('Failed to start Slack app:', error);
      this.isStarted = false;
      throw error;
    }
  }

  /**
   * Stops the Slack app gracefully
   */
  public async stop(): Promise<void> {
    try {
      if (!this.isStarted) {
        Logger.warn('Slack app is already stopped');
        return;
      }

      if (this.useSocketMode) {
        Logger.info('Stopping Slack Socket Mode connection...');
        this.stopHealthMonitoring();
        await this.app.stop();
        Logger.info('Slack Socket Mode connection stopped successfully');
      } else {
        Logger.info('Stopping Slack HTTP mode...');
        // HTTP mode doesn't need explicit stopping
        Logger.info('Slack HTTP mode stopped');
      }

      this.isStarted = false;
    } catch (error) {
      Logger.error('Error stopping Slack app:', error);
      throw error;
    }
  }

  /**
   * Gets the connection status
   */
  public isConnected(): boolean {
    if (!this.useSocketMode) {
      // In HTTP mode, we're always "connected" if started
      return this.isStarted;
    }
    return this.isStarted;
  }

  /**
   * Gets reconnection statistics
   */
  public getConnectionStats(): {
    isConnected: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    mode: 'socket' | 'http';
  } {
    return {
      isConnected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      mode: this.useSocketMode ? 'socket' : 'http',
    };
  }

  /**
   * Stops health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}
