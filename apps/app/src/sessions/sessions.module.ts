import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { CheckpointStorageSyncModule } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.module';
import { MessagesModule } from '../messages/messages.module';
import { SessionHistoryProcessor } from './session-history-processor.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { UserMatrixSqliteSyncService } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';

@Module({
  imports: [MessagesModule, CheckpointStorageSyncModule],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionHistoryProcessor,
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
      useFactory: (
        syncService: UserMatrixSqliteSyncService,
        memoryEngineService: MemoryEngineService,
      ) => {
        return new SessionManagerService(
          syncService,
          undefined,
          memoryEngineService,
        );
      },
      inject: [UserMatrixSqliteSyncService, MemoryEngineService],
    },
  ],
  exports: [SessionsService, SessionHistoryProcessor],
})
export class SessionsModule {}
