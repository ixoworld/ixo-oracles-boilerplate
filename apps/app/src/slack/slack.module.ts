import { Global, Module } from '@nestjs/common';
import { MessagesModule } from 'src/messages/messages.module';
import { SessionsModule } from 'src/sessions/sessions.module';
import { SlackService } from './slack.service';

@Global()
@Module({
  providers: [SlackService],
  exports: [SlackService],
  imports: [MessagesModule, SessionsModule],
})
export class SlackModule {}
