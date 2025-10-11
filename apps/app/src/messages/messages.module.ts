import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerSupportGraph } from 'src/graph';
import { type ENV } from 'src/types';
// SseService is provided globally by SseModule, no need to import or provide here.
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    CustomerSupportGraph,
    {
      provide: MemoryEngineService,
      useFactory: (configService: ConfigService<ENV>) => {
        const memoryEngineUrl = configService.get<string>('MEMORY_ENGINE_URL');
        return new MemoryEngineService(memoryEngineUrl ?? '');
      },
      inject: [ConfigService],
    },
    {
      provide: SessionManagerService,
      useFactory: (memoryEngineService: MemoryEngineService) => {
        return new SessionManagerService(undefined, memoryEngineService);
      },
      inject: [MemoryEngineService],
    },
  ],
})
export class MessagesModule {}
