import { Module } from '@nestjs/common';
import { MatrixManagerRegistryService } from 'src/matrix-registry/matrix-manager-registry-service.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, MatrixManagerRegistryService],
})
export class SessionsModule {}
