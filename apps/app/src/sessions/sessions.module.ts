import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [
    SessionsService,
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
export class SessionsModule {}
