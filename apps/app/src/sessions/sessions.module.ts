import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { MatrixManager } from '@ixo/matrix';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { MessagesModule } from '../messages/messages.module';
import { CheckpointStorageSyncModule } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.module';
import { UserMatrixSqliteSyncService } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { SessionHistoryProcessor } from './session-history-processor.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

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
        return new MemoryEngineService(memoryEngineUrl);
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
          MatrixManager.getInstance(),
          memoryEngineService,
        );
      },
      inject: [UserMatrixSqliteSyncService, MemoryEngineService],
    },
  ],
  exports: [SessionsService, SessionHistoryProcessor],
})
export class SessionsModule {}
