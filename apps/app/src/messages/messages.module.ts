import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MainAgentGraph } from 'src/graph';
import { type ENV } from 'src/types';
// SseService is provided globally by SseModule, no need to import or provide here.
import { MatrixManager } from '@ixo/matrix';
import { CheckpointStorageSyncModule } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.module';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [CheckpointStorageSyncModule],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    MainAgentGraph,
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
          MatrixManager.getInstance(),
          memoryEngineService,
        );
      },
      inject: [UserMatrixSqliteSyncService, MemoryEngineService],
    },
  ],
  exports: [MessagesService, MemoryEngineService, SessionManagerService],
})
export class MessagesModule {}
