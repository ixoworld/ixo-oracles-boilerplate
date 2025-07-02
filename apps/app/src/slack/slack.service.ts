import { Slack } from '@ixo/slack';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private slackInstance?: Slack;
  private readonly isConfigured: boolean;

  constructor(private readonly configService: ConfigService<ENV>) {
    const botToken = configService.get<string>('SLACK_BOT_OAUTH_TOKEN');
    const appToken = configService.get<string>('SLACK_APP_TOKEN');
    const useSocketMode =
      configService.get<string>('SLACK_USE_SOCKET_MODE') === 'true';

    this.isConfigured = Boolean(botToken);

    if (!botToken) {
      this.logger.warn(
        'SLACK_BOT_OAUTH_TOKEN not provided - Slack integration will be disabled',
      );
      return;
    }

    if (useSocketMode && !appToken) {
      this.logger.error(
        'SLACK_APP_TOKEN is required when SLACK_USE_SOCKET_MODE=true',
      );
      throw new Error(
        'SLACK_APP_TOKEN is required when SLACK_USE_SOCKET_MODE=true',
      );
    }

    try {
      this.slackInstance = new Slack(botToken, appToken ?? '', {
        useSocketMode,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Slack instance:', error);
      throw error;
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.slackInstance) {
      this.logger.warn('Slack not configured - skipping initialization');
      return;
    }

    try {
      const useSocketMode =
        this.configService.get('SLACK_USE_SOCKET_MODE') === 'true';
      const mode = useSocketMode ? 'Socket Mode' : 'HTTP Mode';
      this.logger.log(`Initializing Slack ${mode} connection...`);
      await this.slackInstance.start();
      this.logger.log(`Slack ${mode} connection initialized successfully`);
    } catch (error) {
      this.logger.error('Failed to initialize Slack:', error);
      this.logger.warn('Continuing without Slack integration');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.slackInstance) {
      return;
    }

    try {
      this.logger.log('Shutting down Slack connection...');
      await this.slackInstance.stop();
      this.logger.log('Slack connection shut down successfully');
    } catch (error) {
      this.logger.error('Error shutting down Slack:', error);
    }
  }

  /**
   * Get current connection status for health checks
   */
  getStatus(): {
    isConnected: boolean;
    connectionStats: {
      isConnected: boolean;
      reconnectAttempts: number;
      maxReconnectAttempts: number;
      mode: 'socket' | 'http';
    };
    isConfigured: boolean;
  } {
    if (!this.isConfigured || !this.slackInstance) {
      return {
        isConnected: false,
        connectionStats: {
          isConnected: false,
          reconnectAttempts: 0,
          maxReconnectAttempts: 0,
          mode: 'http',
        },
        isConfigured: false,
      };
    }

    return {
      isConnected: this.slackInstance.isConnected(),
      connectionStats: this.slackInstance.getConnectionStats(),
      isConfigured: true,
    };
  }

  static async createInstance(
    BOT_OAUTH_TOKEN: string,
    SLACK_APP_TOKEN?: string,
    options?: { useSocketMode?: boolean },
  ): Promise<Slack> {
    const slackService = new Slack(BOT_OAUTH_TOKEN, SLACK_APP_TOKEN, options);
    await slackService.start();
    return slackService;
  }
}
