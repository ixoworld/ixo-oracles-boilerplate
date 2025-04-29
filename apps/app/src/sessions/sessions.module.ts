import { SessionManagerService } from '@ixo/common';
import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, SessionManagerService],
})
export class SessionsModule {}
