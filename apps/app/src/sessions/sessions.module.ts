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
export class SessionsModule {}
