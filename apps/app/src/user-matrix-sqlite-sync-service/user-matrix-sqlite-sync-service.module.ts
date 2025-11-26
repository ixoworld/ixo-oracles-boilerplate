import { Module } from '@nestjs/common';
import { UserMatrixSqliteSyncService } from './user-matrix-sqlite-sync-service.service';

@Module({
  providers: [
    {
      provide: UserMatrixSqliteSyncService,
      useFactory: () => UserMatrixSqliteSyncService.getInstance(),
    },
  ],
  exports: [UserMatrixSqliteSyncService],
})
export class CheckpointStorageSyncModule {}
