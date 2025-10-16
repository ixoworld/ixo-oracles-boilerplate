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
        const memoryEngineUrl =
          configService.getOrThrow<string>('MEMORY_ENGINE_URL');
        const memoryServiceApiKey = configService.getOrThrow<string>(
          'MEMORY_SERVICE_API_KEY',
        );
        return new MemoryEngineService(memoryEngineUrl, memoryServiceApiKey);
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
