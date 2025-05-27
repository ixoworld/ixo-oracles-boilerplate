import { Module } from '@nestjs/common';
import { CustomerSupportGraph } from 'src/graph';
// SseService is provided globally by SseModule, no need to import or provide here.
import { MatrixManagerRegistryService } from 'src/matrix-registry/matrix-manager-registry-service.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController],
  providers: [
    MessagesService,
    CustomerSupportGraph,
    MatrixManagerRegistryService,
  ],
})
export class MessagesModule {}
