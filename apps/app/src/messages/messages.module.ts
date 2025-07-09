import { SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { CustomerSupportGraph } from 'src/graph';
import { QueueModule } from 'src/queue/queue.module';
// SseService is provided globally by SseModule, no need to import or provide here.
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [QueueModule],
  controllers: [MessagesController],
  providers: [MessagesService, CustomerSupportGraph, SessionManagerService],
})
export class MessagesModule {}
