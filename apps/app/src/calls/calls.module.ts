import { MatrixManager } from '@ixo/matrix';
import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
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
