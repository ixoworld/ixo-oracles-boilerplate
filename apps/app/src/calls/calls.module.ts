import { MatrixManager } from '@ixo/matrix';
import { Module } from '@nestjs/common';
import { CheckpointStorageSyncModule } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [CheckpointStorageSyncModule],
  providers: [
    CallsService,
    {
      useFactory(...args) {
        return MatrixManager.getInstance();
      },
      provide: 'MATRIX_MANAGER',
    },
  ],
  controllers: [CallsController],
})
export class CallsModule {}
