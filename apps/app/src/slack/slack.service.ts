import { Slack } from '@ixo/slack';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';

@Injectable()
export class SlackService extends Slack implements OnModuleInit {
  constructor(configService: ConfigService<ENV>) {
    super(
      configService.getOrThrow('SLACK_BOT_OAUTH_TOKEN'),
      configService.getOrThrow('SLACK_APP_LEVEL_TOKEN'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  static async createInstance(
    BOT_OAUTH_TOKEN: string,
    SLACK_APP_LEVEL_TOKEN: string,
  ): Promise<Slack> {
    const slackService = new Slack(BOT_OAUTH_TOKEN, SLACK_APP_LEVEL_TOKEN);
    await slackService.start();
    return slackService;
  }
}
